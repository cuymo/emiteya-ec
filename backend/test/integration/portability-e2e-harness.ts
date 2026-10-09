// Instalación de la portabilidad para la prueba end-to-end, el benchmark y la revisión de la
// interfaz (add-data-portability, tareas 6.3, 7.1 y 7.2): main.ts como proceso sobre un esquema
// aislado y un directorio de paquetes propio, sin firma ni transmisión. La configuración tributaria,
// el logo, dos establecimientos con su punto y una operadora se cargan por la API real; los
// comprobantes de los seis tipos en los dos ambientes, sus artefactos, las respuestas del SRI, los
// terceros, los productos, el inventario y los secretos marcados, con los arneses de integración.
// Los datos de autenticación marcados son de un usuario sembrado que no inicia sesión.
import { pngBytes } from "../fixtures/images.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { startE2eBackend, type E2eBackend } from "./e2e-backend.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { insertMember } from "./fixtures.ts";
import { completeAuthorizedArtifacts, seedPortabilityExtras } from "./portability-harness.ts";
import { seedReportData } from "./reports-api-harness.ts";

export const PORTABILITY_ADMIN = {
  name: "Ana Administradora",
  email: "admin@e2e-portabilidad.ec",
  password: "contrasena-admin-e2e-1",
};
export const PORTABILITY_OPERATOR = {
  name: "Olga Operadora",
  email: "operador@e2e-portabilidad.ec",
  password: "contrasena-operador-e2e-1",
};

export type PortabilityInstallation = {
  db: MigratedSchema;
  backend: E2eBackend;
  company: FiscalCompany;
  cookies: { admin: string; operator: string };
  ids: Record<string, string>;
};

/** El entorno de la portabilidad del proceso: su directorio y un barrido que no interfiere. */
export function portabilityEnv(directory: string, env: Record<string, string> = {}) {
  return {
    RIDE_SWEEP_INTERVAL_SECONDS: "86400",
    DATA_EXPORT_DIRECTORY: directory,
    DATA_EXPORT_SWEEP_INTERVAL_SECONDS: "86400",
    // Los datos de las pruebas son pequeños: la reserva mínima basta.
    DATA_EXPORT_DISK_RESERVE_MIB: "64",
    ...env,
  };
}

/** Arranca main.ts y carga por la API lo que la API carga; devuelve las cookies de las dos. */
export async function provisionPortability(options: {
  label: string;
  directory: string;
  env?: Record<string, string>;
  port?: number;
}): Promise<Omit<PortabilityInstallation, "ids">> {
  const db = await createMigratedSchema(options.label);
  const backend = await startE2eBackend({
    label: options.label,
    admin: PORTABILITY_ADMIN,
    db,
    env: portabilityEnv(options.directory, options.env),
    ...(options.port ? { port: options.port } : {}),
  });
  const admin = (await backend.signIn(PORTABILITY_ADMIN.email, PORTABILITY_ADMIN.password)).cookie;
  const send = async (method: string, path: string, body: unknown, expected: number) => {
    const res = await backend.fetchApi(method, path, admin, body);
    if (res.status !== expected) throw new Error(`${method} ${path}: ${res.status}`);
    return ((await res.json()) as { data: { id: string; version?: number } }).data;
  };
  const taxpayer = await send(
    "PUT",
    "/taxpayer",
    {
      ruc: "1790012345001",
      legalName: "COMERCIAL ANDINA S.A.",
      tradeName: "Andina",
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      accountingRequired: true,
      expectedVersion: null,
    },
    200,
  );
  const logo = await fetch(
    `${backend.base}/api/v1/taxpayer/logo?expectedVersion=${taxpayer.version ?? 1}`,
    {
      method: "PUT",
      headers: { cookie: admin, origin: "http://localhost:3000", "content-type": "image/png" },
      body: new Uint8Array(pngBytes(80, 40, 9)),
    },
  );
  if (logo.status !== 200) throw new Error(`PUT /taxpayer/logo: ${logo.status}`);
  const points: FiscalCompany["points"] = [];
  for (const code of ["001", "002"]) {
    const establishment = await send(
      "POST",
      "/establishments",
      { code, address: `Calle ${code}` },
      201,
    );
    const point = await send(
      "POST",
      `/establishments/${establishment.id}/emission-points`,
      { code: "001" },
      201,
    );
    points.push({ establishmentId: establishment.id, emissionPointId: point.id, code });
  }
  await send(
    "POST",
    "/users",
    {
      name: PORTABILITY_OPERATOR.name,
      email: PORTABILITY_OPERATOR.email,
      password: PORTABILITY_OPERATOR.password,
      role: "OPERATOR",
    },
    201,
  );
  const operator = (await backend.signIn(PORTABILITY_OPERATOR.email, PORTABILITY_OPERATOR.password))
    .cookie;
  const prisma = db.database.prisma;
  const user = await prisma.user.findFirstOrThrow({ where: { email: PORTABILITY_ADMIN.email } });
  const companyId = (await prisma.member.findFirstOrThrow({ where: { userId: user.id } }))
    .organizationId;
  return {
    db,
    backend,
    company: { companyId, adminId: user.id, points },
    cookies: { admin, operator },
  };
}

/** Siembra los datos de la empresa que la API no carga en una instalación de prueba. */
export async function seedPortabilityCompany(db: MigratedSchema, company: FiscalCompany) {
  const prisma = db.database.prisma;
  const ids = await seedReportData(prisma, company);
  const marked = await insertMember(prisma, company.companyId, {
    name: "Usuario Marcado",
    email: "marcado@e2e-portabilidad.ec",
    role: "OPERATOR",
  });
  Object.assign(
    ids,
    await seedPortabilityExtras(prisma, company, ids.invoice!, {
      configured: true,
      authUserId: marked.userId,
    }),
  );
  await completeAuthorizedArtifacts(prisma, company.companyId);
  return ids;
}

export async function startPortabilityInstallation(options: {
  label: string;
  directory: string;
  env?: Record<string, string>;
  port?: number;
}): Promise<PortabilityInstallation> {
  const installation = await provisionPortability(options);
  try {
    const ids = await seedPortabilityCompany(installation.db, installation.company);
    return { ...installation, ids };
  } catch (error) {
    await installation.backend.stop();
    await installation.db.drop();
    throw error;
  }
}

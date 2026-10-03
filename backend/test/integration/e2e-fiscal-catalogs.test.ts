// Prueba end-to-end de add-fiscal-catalogs (tarea 7.1, design D18) contra el backend real: arranca
// main.ts como proceso sobre un esquema vacío, que carga los datasets al arrancar, recorre por HTTP
// la consulta y la habilitación, y arranca otra vez sobre el mismo esquema.
import type { CatalogEntriesView, CatalogEntryView } from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-catalogos.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = {
  name: "Olga Operadora",
  email: "operador@e2e-catalogos.ec",
  password: "contrasena-operador-e2e-1",
};
// 5 tipos de identificación + 3 impuestos + 9 IVA + 75 ICE + 1 IRBPNR + 8 formas de pago.
const LOADED = { datasets: 10, keys: 101, entries: 101, policy: 1, schemas: 13, cases: 26 };

/** Registro de arranque de la carga de catálogos (main.ts con LOG_LEVEL=info). */
function loadReport(output: string): { applied: string[]; alreadyApplied: number } {
  const line = output
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as { msg?: string; applied?: string[]; alreadyApplied?: number })
    .find((l) => l.msg === "catálogos fiscales cargados");
  if (!line) throw new Error(`Sin registro de la carga de catálogos:\n${output}`);
  return { applied: line.applied!, alreadyApplied: line.alreadyApplied! };
}

describe("flujo completo de los catálogos fiscales", () => {
  let db: MigratedSchema;
  let backend: E2eBackend;

  const start = () =>
    startE2eBackend({ label: "end_to_end_catalogs", admin: ADMIN, db, env: { LOG_LEVEL: "info" } });

  beforeAll(async () => {
    db = await createMigratedSchema("end_to_end_catalogs");
    backend = await start();
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
    await db?.drop();
  });

  async function signIn(email: string, password: string) {
    const { status, cookie } = await backend.signIn(email, password);
    expect(status).toBe(200);
    return cookie;
  }

  async function api<T>(method: string, path: string, cookie: string, body?: unknown) {
    const res = await backend.fetchApi(method, path, cookie, body);
    const json = (await res.json()) as { data: T; error?: { code: string } };
    return { status: res.status, data: json.data, error: json.error };
  }

  const entries = async (cookie: string, catalog: string) =>
    (await api<CatalogEntriesView>("GET", `/fiscal-catalogs/${catalog}/entries`, cookie)).data;
  const enablement = (cookie: string, catalog: string, key: string, enabled: boolean) =>
    api<CatalogEntryView>("PUT", `/fiscal-catalogs/${catalog}/entries/${key}/enablement`, cookie, {
      enabled,
    });

  const counts = async () => {
    const prisma = db.database.prisma;
    return {
      datasets: await prisma.fiscalCatalogDataset.count(),
      keys: await prisma.fiscalCatalogKey.count(),
      entries: await prisma.fiscalCatalogEntry.count(),
      policy: await prisma.consumerFinalPolicy.count(),
      schemas: await prisma.schemaRegistryEntry.count(),
      cases: await prisma.specialCaseSupport.count(),
    };
  };
  /** Estado completo que un arranque podría alterar: datasets, versiones, decisiones y auditoría. */
  const snapshot = async () => {
    const prisma = db.database.prisma;
    return {
      datasets: await prisma.fiscalCatalogDataset.findMany({
        orderBy: [{ catalogType: "asc" }, { version: "asc" }],
      }),
      entries: await prisma.fiscalCatalogEntry.findMany({ orderBy: { id: "asc" } }),
      settings: await prisma.companyFiscalCatalogSetting.findMany({
        orderBy: [{ catalogType: "asc" }, { entryKey: "asc" }],
      }),
      audit: await prisma.auditEvent.findMany({ orderBy: { occurredAt: "asc" } }),
    };
  };

  it("carga al arrancar, consulta, habilita con auditoría y un segundo arranque no cambia nada", async () => {
    // 1. El arranque carga los diez datasets, sin auditoría por la carga.
    expect(loadReport(backend.output())).toMatchObject({ alreadyApplied: 0 });
    expect(loadReport(backend.output()).applied).toHaveLength(10);
    expect(await counts()).toEqual(LOADED);
    const admin = await signIn(ADMIN.email, ADMIN.password);
    expect((await api("POST", "/users", admin, { ...OPERATOR, role: "OPERATOR" })).status).toBe(
      201,
    );
    const operator = await signIn(OPERATOR.email, OPERATOR.password);

    // 2. El operador consulta las tarifas de IVA con su fuente.
    const iva = await entries(operator, "iva-rate");
    expect(iva.catalog).toMatchObject({
      catalogType: "iva-rate",
      datasetVersion: 1,
      enablementPolicy: "DEFAULT_ENABLED",
      source: {
        version: "2.34",
        publishedOn: "2026-07-27",
        sha256: "7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9",
      },
    });
    expect(iva.entries.map((e) => e.code)).toEqual(["0", "2", "3", "4", "5", "6", "7", "8", "10"]);
    expect(iva.entries.find((e) => e.code === "4")).toMatchObject({
      applicable: {
        effectiveFromBasis: "PROJECT_BASELINE",
        rate: { rateKind: "PERCENTAGE", percentage: "15" },
      },
      enablement: { enabled: true, source: "DEFAULT" },
      usable: true,
    });

    // 3. El administrador deshabilita el IVA 12 % y habilita un ICE.
    expect(await enablement(admin, "iva-rate", "2", false)).toMatchObject({
      status: 200,
      data: { enablement: { enabled: false, source: "COMPANY" }, usable: false },
    });
    expect(await enablement(admin, "ice-rate", "3011", true)).toMatchObject({
      status: 200,
      data: { enablement: { enabled: true, source: "COMPANY" }, usable: true },
    });
    // Repetirla no cambia nada ni genera otro evento.
    expect((await enablement(admin, "ice-rate", "3011", true)).status).toBe(200);
    expect(
      (await entries(operator, "iva-rate")).entries.find((e) => e.code === "2")?.enablement,
    ).toEqual({ enabled: false, source: "COMPANY" });

    // 4. El operador no puede habilitar.
    expect(await enablement(operator, "ice-rate", "3021", true)).toMatchObject({
      status: 403,
      error: { code: "FORBIDDEN" },
    });

    // 5. La auditoría tiene las dos transiciones y ninguna por la carga.
    const events = await db.database.prisma.auditEvent.findMany({
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => [e.actorType, e.action])).toEqual([
      ["SYSTEM", "company.provisioned"],
      ["USER", "user.created"],
      ["USER", "fiscal_catalog.entry_disabled"],
      ["USER", "fiscal_catalog.entry_enabled"],
    ]);
    expect(events.slice(2).map((e) => e.changes)).toEqual([
      {
        catalogType: "iva-rate",
        entryKey: "2",
        code: "2",
        "enabled.from": true,
        "enabled.to": false,
      },
      {
        catalogType: "ice-rate",
        entryKey: "3011",
        code: "3011",
        "enabled.from": false,
        "enabled.to": true,
      },
    ]);

    // 6. Un segundo arranque sobre el mismo esquema no cambia nada.
    const before = await snapshot();
    await backend.stop();
    backend = await start();
    expect(loadReport(backend.output())).toEqual({ applied: [], alreadyApplied: LOADED.datasets });
    expect(await snapshot()).toEqual(before);
    const again = await signIn(ADMIN.email, ADMIN.password);
    expect(
      (await entries(again, "ice-rate")).entries.find((e) => e.entryKey === "3011")?.enablement,
    ).toEqual({ enabled: true, source: "COMPANY" });
  }, 180_000);
});

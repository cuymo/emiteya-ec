// Prueba end-to-end de add-taxpayer-setup (tarea 11.1) contra el backend real: arranca main.ts como
// proceso sobre un esquema vacío, que se aprovisiona al arrancar, y recorre por HTTP el flujo que
// la interfaz muestra en Inicio, en el aviso de ambiente y en Mi cuenta.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e-empresa.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = {
  name: "Olga Operadora",
  email: "olga@e2e-empresa.ec",
  password: "contrasena-operadora-1",
};

type Status = {
  environment: string;
  readiness: { ready: boolean; checks: { key: string; status: string }[] };
};

describe("flujo completo de configuración tributaria", () => {
  let backend: E2eBackend;

  beforeAll(async () => {
    backend = await startE2eBackend({ label: "end_to_end_taxpayer", admin: ADMIN });
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
  });

  async function signIn(email: string, password: string) {
    const { status, cookie } = await backend.signIn(email, password);
    expect(status).toBe(200);
    return cookie;
  }

  async function api<T>(method: string, path: string, cookie: string, body?: unknown) {
    const res = await backend.fetchApi(method, path, cookie, body);
    const json = (await res.json()) as { data: T };
    return { status: res.status, data: json.data };
  }

  const statusOf = (key: string, status: Status) =>
    status.readiness.checks.find((check) => check.key === key)?.status;

  it("configura la empresa, la lleva a Producción y refleja cada cambio para ambos roles", async () => {
    const admin = await signIn(ADMIN.email, ADMIN.password);
    expect((await api("POST", "/users", admin, { ...OPERATOR, role: "OPERATOR" })).status).toBe(
      201,
    );
    const operator = await signIn(OPERATOR.email, OPERATOR.password);

    // Empresa recién aprovisionada: en Pruebas y con los tres requisitos pendientes.
    for (const cookie of [admin, operator]) {
      const { data } = await api<Status>("GET", "/company/status", cookie);
      expect(data.environment).toBe("TEST");
      expect(data.readiness.checks.every((check) => check.status === "PENDING")).toBe(true);
    }

    // El administrador registra los datos y crea un establecimiento con un punto.
    const registered = await api<{ version: number }>("PUT", "/taxpayer", admin, {
      ruc: "1790012345001",
      legalName: "Comercial Andina S.A.",
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      accountingRequired: true,
      expectedVersion: null,
    });
    expect(registered).toMatchObject({ status: 200, data: { version: 1 } });
    const establishment = await api<{ id: string }>("POST", "/establishments", admin, {
      code: "001",
      address: "Av. Amazonas N24-03, Quito",
    });
    const point = await api<{ id: string }>(
      "POST",
      `/establishments/${establishment.data.id}/emission-points`,
      admin,
      { code: "001" },
    );
    expect(point.status).toBe(201);

    // Inicio: dos requisitos cumplidos y la firma pendiente; el operador sigue en Pruebas.
    for (const cookie of [admin, operator]) {
      const { data } = await api<Status>("GET", "/company/status", cookie);
      expect(data.readiness.ready).toBe(false);
      expect(statusOf("TAXPAYER_DATA", data)).toBe("MET");
      expect(statusOf("EMISSION_POINT", data)).toBe("MET");
      expect(statusOf("SIGNING_CERTIFICATE", data)).toBe("PENDING");
      expect(data.environment).toBe("TEST");
    }

    // El operador elige su punto predeterminado.
    const chosen = await api<{ available: boolean }>(
      "PUT",
      "/me/default-emission-point",
      operator,
      {
        emissionPointId: point.data.id,
      },
    );
    expect(chosen).toMatchObject({ status: 200, data: { available: true } });

    // El administrador pasa a Producción: el aviso de Pruebas desaparece para ambos.
    const production = await api<{ environment: string }>("PUT", "/taxpayer/environment", admin, {
      environment: "PRODUCTION",
      expectedVersion: 1,
    });
    expect(production.data.environment).toBe("PRODUCTION");
    for (const cookie of [admin, operator]) {
      expect((await api<Status>("GET", "/company/status", cookie)).data.environment).toBe(
        "PRODUCTION",
      );
    }

    // El administrador desactiva el punto: el predeterminado del operador queda no disponible.
    const deactivated = await api(
      "PUT",
      `/establishments/${establishment.data.id}/emission-points/${point.data.id}/status`,
      admin,
      { status: "INACTIVE" },
    );
    expect(deactivated.status).toBe(200);
    expect(
      (await api<{ available: boolean }>("GET", "/me/default-emission-point", operator)).data,
    ).toMatchObject({ available: false });
    expect(
      statusOf("EMISSION_POINT", (await api<Status>("GET", "/company/status", operator)).data),
    ).toBe("PENDING");

    // El rastro de auditoría registra cada cambio con su actor; el predeterminado no se audita.
    const events = await backend.db.database.prisma.auditEvent.findMany({
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => [e.actorType, e.action])).toEqual([
      ["SYSTEM", "company.provisioned"],
      ["USER", "user.created"],
      ["USER", "taxpayer.configured"],
      ["USER", "establishment.created"],
      ["USER", "emission_point.created"],
      ["USER", "taxpayer.environment_changed"],
      ["USER", "emission_point.deactivated"],
    ]);
  });
});

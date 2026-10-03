// Prueba end-to-end de add-taxpayer-setup (tarea 11.1) contra el backend real: arranca main.ts como
// proceso sobre un esquema vacío, que se aprovisiona al arrancar, y recorre por HTTP el flujo que
// la interfaz muestra en Inicio, en el aviso de ambiente y en Mi cuenta.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKEND_DIR, createMigratedSchema, type MigratedSchema } from "./database.ts";

const ORIGIN = "http://localhost:3000";
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

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

describe("flujo completo de configuración tributaria", () => {
  let db: MigratedSchema;
  let backend: ChildProcess;
  let base: string;
  let output = "";

  beforeAll(async () => {
    db = await createMigratedSchema("end_to_end_taxpayer");
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    backend = spawn(process.execPath, ["--conditions=development", "src/main.ts"], {
      cwd: BACKEND_DIR,
      env: {
        PATH: process.env.PATH,
        PORT: String(port),
        DATABASE_URL: db.url,
        BETTER_AUTH_SECRET: "secreto-de-pruebas-e2e-0123456789abcdef",
        BETTER_AUTH_URL: ORIGIN,
        INITIAL_USER_EMAIL: ADMIN.email,
        INITIAL_USER_PASSWORD: ADMIN.password,
        LOG_LEVEL: "warn",
        CERTIFICATE_CUSTODY: "disabled",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    backend.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    backend.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const ready = await fetch(`${base}/health/ready`).then(
        (res) => res.ok,
        () => false,
      );
      if (ready) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`El backend no arrancó:\n${output}`);
  }, 120_000);

  afterAll(async () => {
    if (backend && backend.exitCode === null) {
      const exited = new Promise((resolve) => backend.once("exit", resolve));
      backend.kill("SIGTERM");
      await exited;
    }
    await db?.drop();
  });

  async function signIn(email: string, password: string) {
    const res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    return res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  async function api<T>(method: string, path: string, cookie: string, body?: unknown) {
    const res = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { cookie, origin: ORIGIN, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
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
    const events = await db.database.prisma.auditEvent.findMany({ orderBy: { occurredAt: "asc" } });
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

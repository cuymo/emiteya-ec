// Prueba end-to-end de add-user-access (tarea 8.1) contra el backend real: arranca main.ts como
// proceso sobre un esquema vacío, que se aprovisiona al arrancar, y recorre el flujo por HTTP.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKEND_DIR, createMigratedSchema, type MigratedSchema } from "./database.ts";

const ORIGIN = "http://localhost:3000";
const ADMIN = { email: "admin@e2e.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = {
  name: "Olga Operadora",
  email: "olga@e2e.ec",
  password: "contrasena-operadora-1",
};

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

describe("flujo completo de acceso de usuarios", () => {
  let db: MigratedSchema;
  let backend: ChildProcess;
  let base: string;
  let output = "";

  beforeAll(async () => {
    db = await createMigratedSchema("end_to_end");
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
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return { status: res.status, cookie };
  }

  const api = (method: string, path: string, cookie: string, body?: unknown) =>
    fetch(`${base}/api/v1${path}`, {
      method,
      headers: { cookie, origin: ORIGIN, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  it("aprovisiona, administra un operador y revoca y devuelve su acceso", async () => {
    // Aprovisionamiento al arrancar: el administrador inicial entra.
    const admin = await signIn(ADMIN.email, ADMIN.password);
    expect(admin.status).toBe(200);
    const me = (await (await api("GET", "/me", admin.cookie)).json()) as { data: unknown };
    expect(me.data).toEqual({ name: "Administrador", email: ADMIN.email, role: "ADMIN" });

    // El administrador crea un operador.
    const created = await api("POST", "/users", admin.cookie, { ...OPERATOR, role: "OPERATOR" });
    expect(created.status).toBe(201);
    const { data: operatorView } = (await created.json()) as { data: { id: string } };

    // El operador entra y no accede a Usuarios.
    const operator = await signIn(OPERATOR.email, OPERATOR.password);
    expect(operator.status).toBe(200);
    expect((await api("GET", "/me", operator.cookie)).status).toBe(200);
    expect((await api("GET", "/users", operator.cookie)).status).toBe(403);

    // El administrador lo desactiva: la sesión abierta falla en su siguiente operación.
    const deactivated = await api("PUT", `/users/${operatorView.id}/status`, admin.cookie, {
      status: "DEACTIVATED",
    });
    expect(deactivated.status).toBe(200);
    expect((await api("GET", "/me", operator.cookie)).status).toBe(401);
    expect((await signIn(OPERATOR.email, OPERATOR.password)).status).toBe(401);

    // El administrador lo reactiva: vuelve a entrar con su contraseña y rol anteriores.
    const reactivated = await api("PUT", `/users/${operatorView.id}/status`, admin.cookie, {
      status: "ACTIVE",
    });
    expect(reactivated.status).toBe(200);
    const again = await signIn(OPERATOR.email, OPERATOR.password);
    expect(again.status).toBe(200);
    const operatorMe = (await (await api("GET", "/me", again.cookie)).json()) as {
      data: { role: string };
    };
    expect(operatorMe.data.role).toBe("OPERATOR");

    // El rastro de auditoría registra cada cambio con su actor.
    const events = await db.database.prisma.auditEvent.findMany({ orderBy: { occurredAt: "asc" } });
    expect(events.map((e) => [e.actorType, e.action])).toEqual([
      ["SYSTEM", "company.provisioned"],
      ["USER", "user.created"],
      ["USER", "user.deactivated"],
      ["USER", "user.reactivated"],
    ]);
  });
});

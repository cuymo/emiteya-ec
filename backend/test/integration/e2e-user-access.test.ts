// Prueba end-to-end de add-user-access (tarea 8.1) contra el backend real: arranca main.ts como
// proceso sobre un esquema vacío, que se aprovisiona al arrancar, y recorre el flujo por HTTP.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2eBackend, type E2eBackend } from "./e2e-backend.ts";

const ADMIN = { email: "admin@e2e.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = {
  name: "Olga Operadora",
  email: "olga@e2e.ec",
  password: "contrasena-operadora-1",
};

describe("flujo completo de acceso de usuarios", () => {
  let backend: E2eBackend;

  beforeAll(async () => {
    backend = await startE2eBackend({ label: "end_to_end", admin: ADMIN });
  }, 120_000);

  afterAll(async () => {
    await backend?.stop();
  });

  const signIn = (email: string, password: string) => backend.signIn(email, password);
  const api = (method: string, path: string, cookie: string, body?: unknown) =>
    backend.fetchApi(method, path, cookie, body);

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
    const events = await backend.db.database.prisma.auditEvent.findMany({
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => [e.actorType, e.action])).toEqual([
      ["SYSTEM", "company.provisioned"],
      ["USER", "user.created"],
      ["USER", "user.deactivated"],
      ["USER", "user.reactivated"],
    ]);
  });
});

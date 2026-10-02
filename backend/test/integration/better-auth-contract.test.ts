// Tests de contrato del módulo de integración con Better Auth (design D2b). Replican los criterios
// de S-1 que dependen de la configuración. Una actualización de Better Auth solo se acepta si pasan.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import {
  BASE_URL,
  PASSWORD,
  buildAuthApp,
  createMember,
  signIn,
  type AuthApp,
} from "./auth-harness.ts";

describe("contrato de Better Auth", () => {
  let db: MigratedSchema;
  let companyId: string;
  let base: AuthApp;
  const emails = {
    admin: "admin@contrato.ec",
    operator: "operador@contrato.ec",
    inactive: "inactivo@contrato.ec",
    second: "segundo@contrato.ec",
  };

  beforeAll(async () => {
    db = await createMigratedSchema("auth_contract");
    companyId = await insertCompany(db.database.prisma, "Empresa contrato");
    base = buildAuthApp(db);
    await createMember(base.uow, companyId, { name: "Admin", email: emails.admin, role: "ADMIN" });
    await createMember(base.uow, companyId, { name: "Operador", email: emails.operator });
    await createMember(base.uow, companyId, { name: "Segundo", email: emails.second });
    const inactive = await createMember(base.uow, companyId, {
      name: "Inactivo",
      email: emails.inactive,
    });
    await db.database.prisma.member.update({
      where: { organizationId_userId: { organizationId: companyId, userId: inactive } },
      data: { status: "DEACTIVATED" },
    });
  });

  afterAll(async () => {
    await db.drop();
  });

  // El límite nativo de Better Auth guarda su estado en memoria global del proceso: cada prueba
  // usa su propia IP de cliente (detrás de un proxy de confianza) para no heredar contadores.
  let nextIp = 0;
  function client(options: Parameters<typeof buildAuthApp>[1] = {}) {
    const ip = `192.0.2.${++nextIp}`;
    const built = buildAuthApp(db, { trustProxy: 1, ...options });
    return {
      ...built,
      ip,
      signIn: (email: string, password: string, headers: Record<string, string> = {}) =>
        signIn(built.app, email, password, { "X-Forwarded-For": ip, ...headers }),
      get: (url: string, cookie: string) =>
        request(built.app).get(url).set("X-Forwarded-For", ip).set("Cookie", cookie),
      post: (url: string, cookie = "") =>
        request(built.app)
          .post(url)
          .set("X-Forwarded-For", ip)
          .set("Origin", BASE_URL)
          .set("Cookie", cookie),
    };
  }

  const userCount = () => db.database.prisma.user.count();

  describe("registro público deshabilitado", () => {
    it("rechaza el registro sin sesión y no crea la cuenta", async () => {
      const before = await userCount();
      const res = await request(base.app)
        .post("/api/auth/sign-up/email")
        .set("Origin", BASE_URL)
        .send({ name: "Intruso", email: "intruso@contrato.ec", password: PASSWORD });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await userCount()).toBe(before);
    });

    it("rechaza el registro de un usuario autenticado y no crea la cuenta", async () => {
      const c = client();
      const { cookie } = await c.signIn(emails.operator, PASSWORD);
      expect(cookie).not.toBe("");
      const before = await userCount();
      const res = await c
        .post("/api/auth/sign-up/email", cookie)
        .send({ name: "Otro", email: "otro@contrato.ec", password: PASSWORD });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await userCount()).toBe(before);
    });
  });

  describe("inicio y cierre de sesión", () => {
    it("abre una sesión con credenciales correctas", async () => {
      const res = await client().signIn(emails.operator, PASSWORD);
      expect(res.status).toBe(200);
      expect(res.cookie).toMatch(/session_token=/);
    });

    it("responde igual ante contraseña incorrecta, correo inexistente y usuario desactivado", async () => {
      const c = client();
      const wrong = await c.signIn(emails.operator, "contrasena-incorrecta");
      const unknown = await c.signIn("nadie@contrato.ec", PASSWORD);
      const inactive = await c.signIn(emails.inactive, PASSWORD);
      for (const res of [wrong, unknown, inactive]) {
        expect(res.status).toBe(wrong.status);
        expect(res.body).toEqual(wrong.body);
        expect(res.cookie).toBe("");
      }
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    });

    it("ninguna sesión guarda la dirección IP", async () => {
      expect((await client().signIn(emails.admin, PASSWORD)).status).toBe(200);
      const sessions = await db.database.prisma.session.findMany({ select: { ipAddress: true } });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((s) => s.ipAddress === null)).toBe(true);
    });

    it("cerrar sesión invalida la sesión en el servidor aunque se reutilice la cookie", async () => {
      const c = client();
      const { cookie } = await c.signIn(emails.second, PASSWORD);
      const active = await c.get("/api/auth/get-session", cookie);
      expect(active.body).toMatchObject({ user: { email: emails.second } });

      const out = await c.post("/api/auth/sign-out", cookie);
      expect(out.status).toBe(200);
      const reused = await c.get("/api/auth/get-session", cookie);
      expect(reused.body).toBeNull();
    });
  });

  describe("endpoints de los plugins cerrados", () => {
    it("todo endpoint de cliente de Organization y admin responde 404, también con sesión de administrador", async () => {
      const c = client();
      const { app, auth } = c;
      const { cookie } = await c.signIn(emails.admin, PASSWORD);
      const endpoints = Object.values(
        auth.api as Record<string, { path?: string; options?: { method?: string | string[] } }>,
      )
        .filter((endpoint) => typeof endpoint.path === "string")
        .filter(({ path }) => path!.startsWith("/organization/") || path!.startsWith("/admin/"));
      const paths = endpoints.map((e) => e.path);
      // Los que operan sobre usuarios de todas las empresas o sobre la membresía (S-1).
      expect(paths).toEqual(
        expect.arrayContaining([
          "/admin/set-role",
          "/admin/impersonate-user",
          "/admin/set-user-password",
          "/admin/ban-user",
          "/organization/create",
          "/organization/set-active",
          "/organization/update-member-role",
          "/organization/remove-member",
          "/organization/leave",
        ]),
      );
      expect(endpoints.length).toBeGreaterThanOrEqual(30);

      for (const { path, options } of endpoints) {
        const method = ([options?.method ?? "GET"].flat()[0] ?? "GET").toLowerCase();
        const url = `/api/auth${path!.replace(/:(\w+)/g, "x")}`;
        const res = await (
          method === "get"
            ? request(app).get(url)
            : request(app).post(url).send({ organizationId: companyId, userId: "x", role: "ADMIN" })
        )
          .set("X-Forwarded-For", c.ip)
          .set("Origin", BASE_URL)
          .set("Cookie", cookie);
        expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
      }
    });

    it("las llamadas de servidor no pasan por el bloqueo: el alta del plugin admin funciona", async () => {
      const userId = await createMember(base.uow, companyId, {
        name: "Servidor",
        email: "servidor@contrato.ec",
      });
      expect(userId).toBeTruthy();
    });
  });

  describe("sin recuperación pública de contraseña", () => {
    it("solicitar una recuperación falla y no crea ningún token", async () => {
      const c = client();
      const res = await c.post("/api/auth/request-password-reset").send({ email: emails.operator });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await db.database.prisma.verification.count()).toBe(0);
      const reset = await c
        .post("/api/auth/reset-password")
        .send({ newPassword: "nueva-contrasena-123", token: "inventado" });
      expect(reset.status).toBeGreaterThanOrEqual(400);
      expect((await c.signIn(emails.operator, PASSWORD)).status).toBe(200);
    });
  });

  describe("límite de intentos", () => {
    it("cinco fallos de un correo, con cabeceras falsificadas, bloquean ese correo pero no a otro usuario de la misma IP", async () => {
      // Cliente directo: sin proxies de confianza, las cabeceras de IP del cliente no cuentan.
      const { app, events } = buildAuthApp(db, { trustProxy: false });
      for (let i = 0; i < 5; i++) {
        const res = await signIn(app, emails.operator, "contrasena-incorrecta", {
          "X-Forwarded-For": `198.51.100.${i}`,
          "X-Real-IP": `198.51.100.${i}`,
          "X-App-Client-IP": `198.51.100.${i}`,
        });
        expect(res.status).toBe(401);
      }
      const blocked = await signIn(app, emails.operator, PASSWORD, {
        "X-Forwarded-For": "198.51.100.99",
      });
      expect(blocked.status).toBe(429);
      expect(blocked.cookie).toBe("");
      expect((await signIn(app, emails.second, PASSWORD)).status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(events.filter((e) => e.type === "sign_in_failed")).toHaveLength(5);
      expect(events.some((e) => e.type === "rate_limited")).toBe(true);
    });

    it("por debajo del umbral un inicio correcto se acepta y reinicia el contador", async () => {
      const c = client();
      for (let i = 0; i < 4; i++) await c.signIn(emails.second, "contrasena-incorrecta");
      expect((await c.signIn(emails.second, PASSWORD)).status).toBe(200);
      for (let i = 0; i < 4; i++) await c.signIn(emails.second, "contrasena-incorrecta");
      expect((await c.signIn(emails.second, PASSWORD)).status).toBe(200);
    });

    it("doce inicios correctos desde la misma IP no se bloquean", async () => {
      const c = client();
      for (let i = 0; i < 12; i++) {
        const email = i % 2 === 0 ? emails.admin : emails.operator;
        expect((await c.signIn(email, PASSWORD)).status, `inicio ${i + 1}`).toBe(200);
      }
    });

    it("el límite nativo por IP frena una ráfaga de inicios de sesión", async () => {
      const c = client({ settings: { ipRateLimit: { max: 3, windowSeconds: 60 } } });
      for (let i = 0; i < 3; i++) expect((await c.signIn(emails.admin, PASSWORD)).status).toBe(200);
      expect((await c.signIn(emails.operator, PASSWORD)).status).toBe(429);
    });

    it("la ventana del límite por correo termina y vuelve a aceptar", async () => {
      const c = client({ settings: { loginFailures: { max: 2, windowMs: 300 } } });
      await c.signIn(emails.admin, "contrasena-incorrecta");
      await c.signIn(emails.admin, "contrasena-incorrecta");
      expect((await c.signIn(emails.admin, PASSWORD)).status).toBe(429);
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect((await c.signIn(emails.admin, PASSWORD)).status).toBe(200);
    });
  });
});

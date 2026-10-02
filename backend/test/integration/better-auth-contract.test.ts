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
  eventually,
  signIn,
  type AuthApp,
} from "./auth-harness.ts";
import {
  CLIENT_ENDPOINTS,
  getSessionUserId,
  isClientEndpoint,
} from "../../src/modules/identity/infrastructure/better-auth/index.ts";

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
      expect(await getSessionUserId(c.auth, { cookie })).toBeTruthy();

      const out = await c.post("/api/auth/sign-out", cookie);
      expect(out.status).toBe(200);
      expect(await getSessionUserId(c.auth, { cookie })).toBeNull();
    });
  });

  describe("superficie HTTP mínima: allowlist", () => {
    type Endpoint = { path?: string; options?: { method?: string | string[] } };
    const endpointsOf = (auth: AuthApp["auth"]) =>
      Object.values(auth.api as Record<string, Endpoint>)
        .filter(
          (endpoint): endpoint is Endpoint & { path: string } => typeof endpoint.path === "string",
        )
        .map(({ path, options }) => ({
          path,
          method: [options?.method ?? "GET"].flat()[0] ?? "GET",
        }));

    it("solo iniciar sesión, cerrar sesión y cambiar la contraseña propia están permitidos", () => {
      expect(CLIENT_ENDPOINTS.map((e) => `${e.method} ${e.path}`)).toEqual([
        "POST /sign-in/email",
        "POST /sign-out",
        "POST /change-password",
      ]);
    });

    it("todo otro endpoint HTTP de Better Auth responde 404, también con sesión de administrador", async () => {
      const c = client();
      const { cookie } = await c.signIn(emails.admin, PASSWORD);
      const blocked = endpointsOf(c.auth).filter((e) => !isClientEndpoint(e.method, e.path));
      // Sesión, perfil y plugins: lo que Better Auth ofrece pero ninguna spec usa (S-1, D2).
      expect(blocked.map((e) => e.path)).toEqual(
        expect.arrayContaining([
          "/get-session",
          "/update-user",
          "/verify-password",
          "/list-sessions",
          "/sign-up/email",
          "/request-password-reset",
          "/admin/set-role",
          "/admin/impersonate-user",
          "/organization/update-member-role",
          "/organization/leave",
        ]),
      );

      for (const { path, method } of blocked) {
        const url = `/api/auth${path.replace(/:(\w+)/g, "x")}`;
        const res = await (
          method === "GET" ? request(c.app).get(url) : request(c.app).post(url).send({})
        )
          .set("X-Forwarded-For", c.ip)
          .set("Origin", BASE_URL)
          .set("Cookie", cookie);
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    });

    it("el hook también deniega por defecto, aunque una petición llegue a Better Auth sin pasar por Express", async () => {
      const c = client();
      const { cookie } = await c.signIn(emails.admin, PASSWORD);
      const blocked = endpointsOf(c.auth).filter((e) => !isClientEndpoint(e.method, e.path));
      for (const { path, method } of blocked) {
        const res = await c.auth.handler(
          new Request(`${BASE_URL}/api/auth${path.replace(/:(\w+)/g, "x")}`, {
            method,
            headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
            ...(method === "GET" ? {} : { body: "{}" }),
          }),
        );
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    });

    it("/update-user no cambia el nombre ni la imagen, y /verify-password y /list-sessions no responden", async () => {
      const c = client();
      const { cookie } = await c.signIn(emails.operator, PASSWORD);
      const update = await c
        .post("/api/auth/update-user", cookie)
        .send({ name: "Otro nombre", image: "x" });
      expect(update.status).toBe(404);
      const user = await db.database.prisma.user.findUniqueOrThrow({
        where: { email: emails.operator },
      });
      expect(user).toMatchObject({ name: "Operador", image: null });
      expect(
        (await c.post("/api/auth/verify-password", cookie).send({ password: PASSWORD })).status,
      ).toBe(404);
      expect((await c.get("/api/auth/list-sessions", cookie)).status).toBe(404);
      expect((await c.get("/api/auth/get-session", cookie)).status).toBe(404);
    });

    it("variantes de ruta o de método de los endpoints permitidos no llegan a Better Auth", async () => {
      const c = client();
      const { cookie } = await c.signIn(emails.operator, PASSWORD);
      for (const [method, url] of [
        ["get", "/api/auth/sign-in/email"],
        ["get", "/api/auth/sign-out"],
        ["post", "/api/auth/sign-out/"],
        ["post", "/api/auth/SIGN-OUT"],
        ["post", "/api/auth/sign-in%2Femail"],
        ["post", "/api/auth//sign-out"],
      ] as const) {
        const agent = request(c.app);
        const res = await agent[method](url)
          .set("X-Forwarded-For", c.ip)
          .set("Origin", BASE_URL)
          .set("Cookie", cookie);
        expect(res.status, `${method.toUpperCase()} ${url}`).toBe(404);
      }
      expect(await getSessionUserId(c.auth, { cookie })).toBeTruthy();
    });

    it("las llamadas de servidor no pasan por la allowlist: el alta del plugin admin funciona", async () => {
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
      await eventually(() => events.filter((e) => e.type === "sign_in_failed").length === 5);
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

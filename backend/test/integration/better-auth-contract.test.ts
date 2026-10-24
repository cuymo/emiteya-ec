// Tests de contrato del módulo de integración con Better Auth (design D2b). Replican los criterios
// de S-1 que dependen de la configuración. Una actualización de Better Auth solo se acepta si pasan.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    reset: "recupera@contrato.ec",
  };

  beforeAll(async () => {
    db = await createMigratedSchema("auth_contract");
    companyId = await insertCompany(db.database.prisma, "Empresa contrato");
    base = buildAuthApp(db);
    await createMember(base.uow, companyId, { name: "Admin", email: emails.admin, role: "ADMIN" });
    await createMember(base.uow, companyId, { name: "Operador", email: emails.operator });
    await createMember(base.uow, companyId, { name: "Segundo", email: emails.second });
    await createMember(base.uow, companyId, { name: "Recupera", email: emails.reset });
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

    it("solo iniciar y cerrar sesión, cambiar la contraseña propia y la recuperación por correo", () => {
      expect(CLIENT_ENDPOINTS.map((e) => `${e.method} ${e.path}`)).toEqual([
        "POST /sign-in/email",
        "POST /sign-out",
        "POST /change-password",
        "POST /request-password-reset",
        "POST /reset-password",
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
          // La redirección con el token en la consulta sigue cerrada (add-password-reset-by-email, D1).
          "/reset-password/:token",
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

  describe("recuperación de la contraseña por correo (add-password-reset-by-email)", () => {
    type Sent = {
      to: string;
      companyIds: readonly string[];
      link: string;
      expiresInMinutes: number;
    };

    /** Un cliente con un enviador de prueba que guarda cada enlace. */
    function resetClient(outcome: "sent" | "no_mail_server" = "sent") {
      const sent: Sent[] = [];
      const c = client({
        passwordReset: {
          publicOrigin: "https://emiteya.example.ec",
          mailer: {
            send: (input) => {
              sent.push(input);
              return Promise.resolve(outcome);
            },
          },
        },
      });
      const requestReset = (email: string) =>
        c.post("/api/auth/request-password-reset").send({ email });
      return { ...c, sent, requestReset };
    }
    const tokenOf = (link: string) => decodeURIComponent(link.split("#token=")[1] ?? "");
    const resetEvents = (c: { events: { type: string }[] }) =>
      c.events.filter((event) => event.type.startsWith("password_reset"));

    it("envía un enlace al frontend, la contraseña nueva cierra las sesiones y el enlace sirve una vez", async () => {
      const c = resetClient();
      const { cookie } = await c.signIn(emails.reset, PASSWORD);
      expect(await getSessionUserId(c.auth, { cookie })).toBeTruthy();

      const res = await c.requestReset(emails.reset);
      expect(res.status).toBe(200);
      await vi.waitFor(() => expect(c.sent).toHaveLength(1));
      const [mail] = c.sent;
      expect(mail).toMatchObject({
        to: emails.reset,
        companyIds: [companyId],
        expiresInMinutes: 30,
      });
      expect(mail!.link).toMatch(/^https:\/\/emiteya\.example\.ec\/restablecer-contrasena#token=/);
      const token = tokenOf(mail!.link);
      // El token nunca se guarda en claro.
      const stored = await db.database.prisma.verification.findMany({
        select: { identifier: true },
      });
      expect(stored.some((row) => row.identifier.includes(token))).toBe(false);

      const weak = await c.post("/api/auth/reset-password").send({ newPassword: "corta", token });
      expect(weak.status).toBe(400);
      expect((weak.body as { code?: string }).code).toBe("PASSWORD_POLICY");

      const NEW = "contrasena-nueva-segura-1";
      const done = await c.post("/api/auth/reset-password").send({ newPassword: NEW, token });
      expect(done.status).toBe(200);
      expect(await getSessionUserId(c.auth, { cookie })).toBeNull();
      expect((await c.signIn(emails.reset, PASSWORD)).status).toBe(401);
      expect((await c.signIn(emails.reset, NEW)).status).toBe(200);

      const again = await c.post("/api/auth/reset-password").send({ newPassword: PASSWORD, token });
      expect(again.status).toBe(400);
      await vi.waitFor(() =>
        expect(resetEvents(c).map((event) => event.type)).toEqual([
          "password_reset_requested",
          "password_reset_completed",
        ]),
      );
      expect(JSON.stringify(c.events)).not.toContain(token);
      expect(JSON.stringify(c.events)).not.toContain(emails.reset);
      expect(c.logs()).not.toContain(token);
    });

    it("responde igual sin cuenta o con la cuenta desactivada, y no envía nada", async () => {
      const c = resetClient();
      const active = await c.requestReset(emails.second);
      const unknown = await c.requestReset("nadie@contrato.ec");
      const inactive = await c.requestReset(emails.inactive);
      for (const res of [unknown, inactive]) {
        expect(res.status).toBe(active.status);
        expect(res.body).toEqual(active.body);
      }
      await vi.waitFor(() =>
        expect(
          resetEvents(c)
            .map((event) => (event as { outcome?: string }).outcome)
            .sort(),
        ).toEqual(["inactive_membership", "no_account", "sent"]),
      );
      expect(c.sent.map((mail) => mail.to)).toEqual([emails.second]);
    });

    it("un enlace vencido o inventado no cambia la contraseña", async () => {
      const c = resetClient();
      await c.requestReset(emails.second);
      await vi.waitFor(() => expect(c.sent).toHaveLength(1));
      await db.database.prisma.verification.updateMany({
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      const expired = await c
        .post("/api/auth/reset-password")
        .send({ newPassword: "contrasena-nueva-segura-2", token: tokenOf(c.sent[0]!.link) });
      expect(expired.status).toBe(400);
      const invented = await c
        .post("/api/auth/reset-password")
        .send({ newPassword: "contrasena-nueva-segura-2", token: "inventado" });
      expect(invented.status).toBe(400);
      expect((await c.signIn(emails.second, PASSWORD)).status).toBe(200);
    });

    it("más de tres solicitudes del mismo correo e IP en 15 minutos no envían más, con la misma respuesta", async () => {
      const c = resetClient();
      const responses = [];
      for (let i = 0; i < 5; i++) responses.push(await c.requestReset(emails.second));
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body).toEqual(responses[0]!.body);
      }
      await vi.waitFor(() =>
        expect(
          resetEvents(c).filter((event) => (event as { outcome?: string }).outcome === "throttled"),
        ).toHaveLength(2),
      );
      expect(c.sent).toHaveLength(3);
    });

    it("sin servidor de correo en la empresa, la respuesta es la misma y queda el evento", async () => {
      const c = resetClient("no_mail_server");
      const res = await c.requestReset(emails.admin);
      expect(res.status).toBe(200);
      await vi.waitFor(() =>
        expect(resetEvents(c).map((event) => (event as { outcome?: string }).outcome)).toEqual([
          "no_mail_server",
        ]),
      );
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

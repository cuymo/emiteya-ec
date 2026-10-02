// API de cuenta y usuarios (design D10) con la matriz de acceso de docs/quality/testing.md: dos
// empresas, recurso propio, ajeno por ruta, ajeno por cuerpo, operador sobre operación de
// administrador, payload con companyId o rol, sesión revocada y usuario desactivado.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import {
  BASE_URL,
  PASSWORD,
  buildUsersApp,
  createMember,
  signIn,
  type AuthApp,
} from "./auth-harness.ts";

type Body = {
  data: Record<string, unknown> & Record<string, unknown>[];
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const USER_FIELDS = ["createdAt", "email", "id", "name", "role", "status"];

describe("API de cuenta y usuarios", () => {
  let db: MigratedSchema;
  let api: AuthApp;
  let companyA: string;
  let companyB: string;
  const ids: Record<string, string> = {};
  const emails = {
    admin: "admin@a.ec",
    operator: "operador@a.ec",
    target: "objetivo@a.ec",
    inactive: "inactiva@a.ec",
    adminB: "admin@b.ec",
    operatorB: "operador@b.ec",
  };

  beforeAll(async () => {
    db = await createMigratedSchema("users_api");
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    api = buildUsersApp(db, { trustProxy: 1 });
    ids.admin = await createMember(api.uow, companyA, {
      name: "Ana Admin",
      email: emails.admin,
      role: "ADMIN",
    });
    ids.operator = await createMember(api.uow, companyA, {
      name: "Óscar Operador",
      email: emails.operator,
    });
    ids.target = await createMember(api.uow, companyA, {
      name: "Olga Objetivo",
      email: emails.target,
    });
    ids.inactive = await createMember(api.uow, companyA, {
      name: "Inés Inactiva",
      email: emails.inactive,
    });
    await db.database.prisma.member.update({
      where: { organizationId_userId: { organizationId: companyA, userId: ids.inactive } },
      data: { status: "DEACTIVATED" },
    });
    ids.adminB = await createMember(api.uow, companyB, {
      name: "Beatriz B",
      email: emails.adminB,
      role: "ADMIN",
    });
    ids.operatorB = await createMember(api.uow, companyB, {
      name: "Bruno B",
      email: emails.operatorB,
    });
  });

  afterAll(async () => {
    await db.drop();
  });

  // Cada inicio de sesión desde su propia IP: el límite nativo es por IP y su estado es global.
  let ipSeq = 0;
  const ip = () => `192.0.2.${++ipSeq % 250}`;
  async function session(email: string, password = PASSWORD) {
    const res = await signIn(api.app, email, password, { "X-Forwarded-For": ip() });
    expect(res.status, `inicio de sesión de ${email}`).toBe(200);
    return res.cookie;
  }
  const call = (method: "get" | "post" | "put", url: string, cookie: string) => {
    const agent = request(api.app);
    return agent[method](`/api/v1${url}`)
      .set("Origin", BASE_URL)
      .set("Cookie", cookie)
      .set("X-Forwarded-For", ip());
  };
  const events = (where: Record<string, unknown> = {}) =>
    db.database.prisma.auditEvent.findMany({
      where: { companyId: companyA, ...where },
      orderBy: { occurredAt: "asc" },
    });
  const denials = () => api.events.filter((e) => e.type === "authorization_denied");

  describe("GET /me", () => {
    it("devuelve solo nombre, correo y rol, para administrador y operador", async () => {
      const admin = await call("get", "/me", await session(emails.admin));
      expect(admin.status).toBe(200);
      expect(bodyOf(admin).data).toEqual({ name: "Ana Admin", email: emails.admin, role: "ADMIN" });
      const operator = await call("get", "/me", await session(emails.operator));
      expect(bodyOf(operator).data).toEqual({
        name: "Óscar Operador",
        email: emails.operator,
        role: "OPERATOR",
      });
      expect(JSON.stringify(operator.body)).not.toMatch(/password|token|session|companyId|admin"/i);
    });

    it("sin sesión responde 401", async () => {
      expect((await request(api.app).get("/api/v1/me")).status).toBe(401);
    });
  });

  describe("GET /users", () => {
    it("lista solo la empresa del administrador, con campos permitidos y paginación por defecto", async () => {
      const res = await call("get", `/users?companyId=${companyB}`, await session(emails.admin));
      expect(res.status).toBe(200);
      const { data, meta } = bodyOf(res);
      expect(meta).toEqual({ page: 1, pageSize: 25, total: 4 });
      expect(data.map((u) => u.id).sort()).toEqual(
        [ids.admin, ids.operator, ids.target, ids.inactive].sort(),
      );
      for (const user of data) expect(Object.keys(user).sort()).toEqual(USER_FIELDS);
      expect(data.find((u) => u.id === ids.inactive)?.status).toBe("DEACTIVATED");
    });

    it("busca por nombre o correo y filtra por estado", async () => {
      const cookie = await session(emails.admin);
      const byName = bodyOf(await call("get", "/users?search=olga", cookie)).data;
      expect(byName.map((u) => u.id)).toEqual([ids.target]);
      const byEmail = bodyOf(await call("get", "/users?search=OPERADOR%40", cookie)).data;
      expect(byEmail.map((u) => u.id)).toEqual([ids.operator]);
      const otherCompany = bodyOf(await call("get", "/users?search=bruno", cookie));
      expect(otherCompany.data).toEqual([]);
      const inactive = bodyOf(await call("get", "/users?status=DEACTIVATED", cookie)).data;
      expect(inactive.map((u) => u.id)).toEqual([ids.inactive]);
    });

    it("pagina en el servidor y rechaza tamaños fuera de los límites", async () => {
      const cookie = await session(emails.admin);
      const first = bodyOf(await call("get", "/users?page=1&pageSize=3", cookie));
      const second = bodyOf(await call("get", "/users?page=2&pageSize=3", cookie));
      expect(first.data).toHaveLength(3);
      expect(second.data).toHaveLength(1);
      expect(second.meta).toEqual({ page: 2, pageSize: 3, total: 4 });
      expect((await call("get", "/users?pageSize=100", cookie)).status).toBe(200);
      expect((await call("get", "/users?pageSize=101", cookie)).status).toBe(400);
      expect((await call("get", "/users?pageSize=0", cookie)).status).toBe(400);
      expect((await call("get", "/users?page=abc", cookie)).status).toBe(400);
      expect((await call("get", "/users?status=BANNED", cookie)).status).toBe(400);
    });

    it("un operador recibe 403 con evento de seguridad", async () => {
      api.events.length = 0;
      const res = await call("get", "/users", await session(emails.operator));
      expect(res.status).toBe(403);
      expect(denials()).toEqual([expect.objectContaining({ status: 403, action: "users.read" })]);
    });
  });

  describe("POST /users", () => {
    const newUser = (email: string, extra: Record<string, unknown> = {}) => ({
      name: "Nuevo Operador",
      email,
      password: "contrasena-inicial-1",
      role: "OPERATOR",
      ...extra,
    });

    it("crea el usuario con membresía activa, registra el evento y permite iniciar sesión", async () => {
      const res = await call("post", "/users", await session(emails.admin)).send(
        newUser("nuevo@a.ec"),
      );
      expect(res.status).toBe(201);
      const created = bodyOf(res).data;
      expect(created).toMatchObject({
        name: "Nuevo Operador",
        email: "nuevo@a.ec",
        role: "OPERATOR",
        status: "ACTIVE",
      });
      expect(Object.keys(created).sort()).toEqual(USER_FIELDS);
      const [event] = await events({ action: "user.created", targetUserId: created.id });
      expect(event).toMatchObject({
        actorType: "USER",
        actorUserId: ids.admin,
        changes: { role: "OPERATOR" },
      });
      expect(
        (await signIn(api.app, "nuevo@a.ec", "contrasena-inicial-1", { "X-Forwarded-For": ip() }))
          .status,
      ).toBe(200);
    });

    it("rechaza con 409 un correo existente con otra capitalización, sin crear nada", async () => {
      const before = await db.database.prisma.user.count();
      const res = await call("post", "/users", await session(emails.admin)).send(
        newUser("OPERADOR@A.EC"),
      );
      expect(res.status).toBe(409);
      expect(bodyOf(res).error).toMatchObject({
        code: "EMAIL_IN_USE",
        message: "El correo ya está en uso.",
      });
      expect(await db.database.prisma.user.count()).toBe(before);
    });

    it("rechaza datos inválidos indicando el campo, sin crear nada", async () => {
      const cookie = await session(emails.admin);
      const before = await db.database.prisma.user.count();
      const cases: [Record<string, unknown>, string][] = [
        [newUser("x1@a.ec", { name: " " }), "El nombre es obligatorio."],
        [newUser("no-es-correo"), "El correo no tiene un formato válido."],
        [newUser("x2@a.ec", { role: "SUPERADMIN" }), "El rol no es válido."],
        [
          newUser("x3@a.ec", { password: "a".repeat(11) }),
          "La contraseña debe tener al menos 12 caracteres.",
        ],
      ];
      for (const [body, message] of cases) {
        const res = await call("post", "/users", cookie).send(body);
        expect(res.status).toBe(400);
        expect(bodyOf(res).error.message).toBe(message);
      }
      expect(
        (
          await call("post", "/users", cookie).send(
            newUser("x4@a.ec", { password: "a".repeat(12) }),
          )
        ).status,
      ).toBe(201);
      expect(await db.database.prisma.user.count()).toBe(before + 1);
    });

    it("el envío repetido deja una sola cuenta e informa que el correo está en uso", async () => {
      const cookie = await session(emails.admin);
      const body = newUser("repetido@a.ec");
      expect((await call("post", "/users", cookie).send(body)).status).toBe(201);
      expect((await call("post", "/users", cookie).send(body)).status).toBe(409);
      const user = await db.database.prisma.user.findUniqueOrThrow({
        where: { email: "repetido@a.ec" },
      });
      expect(await db.database.prisma.member.count({ where: { userId: user.id } })).toBe(1);
      expect(await events({ action: "user.created", targetUserId: user.id })).toHaveLength(1);
    });

    it("dos altas simultáneas con el mismo correo crean una sola cuenta", async () => {
      const cookie = await session(emails.admin);
      const body = newUser("simultaneo@a.ec");
      const statuses = (
        await Promise.all([1, 2].map(() => call("post", "/users", cookie).send(body)))
      ).map((res) => res.status);
      expect(statuses.sort()).toEqual([201, 409]);
      expect(await db.database.prisma.user.count({ where: { email: "simultaneo@a.ec" } })).toBe(1);
      expect(
        await db.database.prisma.member.count({ where: { user: { email: "simultaneo@a.ec" } } }),
      ).toBe(1);
      const user = await db.database.prisma.user.findUniqueOrThrow({
        where: { email: "simultaneo@a.ec" },
      });
      expect(await events({ action: "user.created", targetUserId: user.id })).toHaveLength(1);
    });

    it("un operador recibe 403 con evento de seguridad y nada se crea", async () => {
      api.events.length = 0;
      const res = await call("post", "/users", await session(emails.operator)).send(
        newUser("operador-crea@a.ec", { role: "ADMIN" }),
      );
      expect(res.status).toBe(403);
      expect(denials()).toEqual([expect.objectContaining({ status: 403, action: "users.create" })]);
      expect(await db.database.prisma.user.count({ where: { email: "operador-crea@a.ec" } })).toBe(
        0,
      );
    });

    it("un companyId en el cuerpo se rechaza y nada se crea, ni en la otra empresa", async () => {
      const res = await call("post", "/users", await session(emails.admin)).send(
        newUser("ajena@a.ec", { companyId: companyB }),
      );
      expect(res.status).toBe(400);
      expect(await db.database.prisma.user.count({ where: { email: "ajena@a.ec" } })).toBe(0);
      expect(await db.database.prisma.member.count({ where: { organizationId: companyB } })).toBe(
        2,
      );
    });
  });

  describe("PUT /users/:userId/role", () => {
    it("promueve a administrador y registra el rol anterior y el nuevo", async () => {
      const promoted = await createMember(api.uow, companyA, {
        name: "Para promover",
        email: "promover@a.ec",
      });
      const res = await call("put", `/users/${promoted}/role`, await session(emails.admin)).send({
        role: "ADMIN",
      });
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toMatchObject({ id: promoted, role: "ADMIN" });
      const [event] = await events({ action: "user.role_changed", targetUserId: promoted });
      expect(event?.changes).toEqual({ from: "OPERATOR", to: "ADMIN" });
    });

    it("asignar el rol que ya tiene, varias veces, no registra cambios", async () => {
      const cookie = await session(emails.admin);
      const before = (await events()).length;
      for (let i = 0; i < 2; i++) {
        const res = await call("put", `/users/${ids.target}/role`, cookie).send({
          role: "OPERATOR",
        });
        expect(res.status).toBe(200);
        expect(bodyOf(res).data.role).toBe("OPERATOR");
      }
      expect(await events()).toHaveLength(before);
    });

    it("cambiar el rol propio responde 409 y no cambia nada", async () => {
      const res = await call("put", `/users/${ids.admin}/role`, await session(emails.admin)).send({
        role: "OPERATOR",
      });
      expect(res.status).toBe(409);
      expect(bodyOf(res).error.code).toBe("OWN_ROLE");
      const member = await db.database.prisma.member.findFirstOrThrow({
        where: { userId: ids.admin },
      });
      expect(member.role).toBe("ADMIN");
    });

    it("un usuario de otra empresa responde 404 con evento de seguridad y no cambia", async () => {
      api.events.length = 0;
      const res = await call(
        "put",
        `/users/${ids.operatorB}/role`,
        await session(emails.admin),
      ).send({ role: "ADMIN" });
      expect(res.status).toBe(404);
      expect(denials()).toEqual([
        expect.objectContaining({ status: 404, action: "users.changeRole" }),
      ]);
      const member = await db.database.prisma.member.findFirstOrThrow({
        where: { userId: ids.operatorB },
      });
      expect(member.role).toBe("OPERATOR");
    });

    it("un operador recibe 403 aunque se atribuya el rol de administrador", async () => {
      const res = await call(
        "put",
        `/users/${ids.target}/role?role=ADMIN`,
        await session(emails.operator),
      )
        .set("X-Role", "ADMIN")
        .send({ role: "ADMIN" });
      expect(res.status).toBe(403);
    });
  });

  describe("PUT /users/:userId/status", () => {
    it("desactivar rechaza la siguiente operación de la sesión abierta y el inicio de sesión", async () => {
      const userId = await createMember(api.uow, companyA, {
        name: "Con sesión",
        email: "consesion@a.ec",
      });
      const victim = await session("consesion@a.ec");
      expect((await call("get", "/me", victim)).status).toBe(200);

      const res = await call("put", `/users/${userId}/status`, await session(emails.admin)).send({
        status: "DEACTIVATED",
      });
      expect(res.status).toBe(200);
      expect(bodyOf(res).data.status).toBe("DEACTIVATED");
      expect((await call("get", "/me", victim)).status).toBe(401);
      const retry = await signIn(api.app, "consesion@a.ec", PASSWORD, { "X-Forwarded-For": ip() });
      expect(retry.status).toBe(401);
      expect(retry.body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
      const listed = bodyOf(
        await call("get", "/users?search=consesion", await session(emails.admin)),
      ).data;
      expect(listed[0]?.status).toBe("DEACTIVATED");
    });

    it("desactivar a un usuario ya desactivado no registra un segundo cambio", async () => {
      const cookie = await session(emails.admin);
      const before = (await events({ targetUserId: ids.inactive })).length;
      expect(
        (await call("put", `/users/${ids.inactive}/status`, cookie).send({ status: "DEACTIVATED" }))
          .status,
      ).toBe(200);
      expect(await events({ targetUserId: ids.inactive })).toHaveLength(before);
    });

    it("desactivarse a sí mismo responde 409 y la cuenta sigue activa", async () => {
      const res = await call("put", `/users/${ids.admin}/status`, await session(emails.admin)).send(
        { status: "DEACTIVATED" },
      );
      expect(res.status).toBe(409);
      expect(bodyOf(res).error.code).toBe("OWN_STATUS");
      expect((await call("get", "/me", await session(emails.admin))).status).toBe(200);
    });

    it("reactivar devuelve el acceso con el rol y la contraseña anteriores", async () => {
      const userId = await createMember(api.uow, companyA, {
        name: "Vuelve",
        email: "vuelve@a.ec",
        role: "ADMIN",
      });
      const admin = await session(emails.admin);
      await call("put", `/users/${userId}/status`, admin).send({ status: "DEACTIVATED" });
      const res = await call("put", `/users/${userId}/status`, admin).send({ status: "ACTIVE" });
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toMatchObject({ status: "ACTIVE", role: "ADMIN" });
      const me = await call("get", "/me", await session("vuelve@a.ec"));
      expect(bodyOf(me).data.role).toBe("ADMIN");
      const actions = (await events({ targetUserId: userId })).map((e) => e.action);
      expect(actions).toEqual(["user.deactivated", "user.reactivated"]);
      // Reactivar a un usuario activo no registra otro cambio.
      await call("put", `/users/${userId}/status`, admin).send({ status: "ACTIVE" });
      expect(await events({ targetUserId: userId })).toHaveLength(2);
    });

    it("un usuario de otra empresa responde 404 y no cambia", async () => {
      const res = await call(
        "put",
        `/users/${ids.operatorB}/status`,
        await session(emails.admin),
      ).send({ status: "DEACTIVATED" });
      expect(res.status).toBe(404);
      const member = await db.database.prisma.member.findFirstOrThrow({
        where: { userId: ids.operatorB },
      });
      expect(member.status).toBe("ACTIVE");
    });
  });

  describe("PUT /users/:userId/password", () => {
    const NEW = "establecida-por-admin-1";

    it("la contraseña nueva funciona, la anterior no, y las sesiones del objetivo se invalidan", async () => {
      const userId = await createMember(api.uow, companyA, {
        name: "Olvidadiza",
        email: "olvido@a.ec",
      });
      const old = await session("olvido@a.ec");
      const res = await call("put", `/users/${userId}/password`, await session(emails.admin)).send({
        password: NEW,
      });
      expect(res.status).toBe(204);
      expect((await call("get", "/me", old)).status).toBe(401);
      expect(
        (await signIn(api.app, "olvido@a.ec", PASSWORD, { "X-Forwarded-For": ip() })).status,
      ).toBe(401);
      expect((await signIn(api.app, "olvido@a.ec", NEW, { "X-Forwarded-For": ip() })).status).toBe(
        200,
      );
      const [event] = await events({ action: "user.password_set", targetUserId: userId });
      expect(event).toMatchObject({ actorUserId: ids.admin });
      expect(JSON.stringify(event)).not.toContain(NEW);
    });

    it("la propia contraseña por esta vía se rechaza e indica el cambio propio", async () => {
      const res = await call(
        "put",
        `/users/${ids.admin}/password`,
        await session(emails.admin),
      ).send({ password: NEW });
      expect(res.status).toBe(409);
      expect(bodyOf(res).error.message).toMatch(/Mi cuenta/);
    });

    it("aplica la política de longitud y no cambia la contraseña anterior", async () => {
      const res = await call(
        "put",
        `/users/${ids.target}/password`,
        await session(emails.admin),
      ).send({ password: "corta" });
      expect(res.status).toBe(400);
      expect(bodyOf(res).error.message).toBe("La contraseña debe tener al menos 12 caracteres.");
      expect(
        (await signIn(api.app, emails.target, PASSWORD, { "X-Forwarded-For": ip() })).status,
      ).toBe(200);
    });

    it("otra empresa responde 404 y el operador recibe 403, sin cambios", async () => {
      expect(
        (
          await call("put", `/users/${ids.operatorB}/password`, await session(emails.admin)).send({
            password: NEW,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await call("put", `/users/${ids.target}/password`, await session(emails.operator)).send({
            password: NEW,
          })
        ).status,
      ).toBe(403);
      expect(
        (await signIn(api.app, emails.operatorB, PASSWORD, { "X-Forwarded-For": ip() })).status,
      ).toBe(200);
      expect(
        (await signIn(api.app, emails.target, PASSWORD, { "X-Forwarded-For": ip() })).status,
      ).toBe(200);
    });
  });

  describe("atomicidad y contenido de la auditoría", () => {
    it("si el evento no puede registrarse, el cambio de rol no se aplica", async () => {
      const failing = buildUsersApp(db, {
        trustProxy: 1,
        wrapUow: (uow) => ({
          run: (work) =>
            uow.run((scope) =>
              work({
                ...scope,
                audit: { append: () => Promise.reject(new Error("auditoría caída")) },
              }),
            ),
        }),
      });
      const { cookie } = await signIn(failing.app, emails.admin, PASSWORD, {
        "X-Forwarded-For": ip(),
      });
      const res = await request(failing.app)
        .put(`/api/v1/users/${ids.target}/role`)
        .set("Origin", BASE_URL)
        .set("Cookie", cookie)
        .set("X-Forwarded-For", ip())
        .send({ role: "ADMIN" });
      expect(res.status).toBe(500);
      expect(bodyOf(res).error.code).toBe("INTERNAL_ERROR");
      const member = await db.database.prisma.member.findFirstOrThrow({
        where: { userId: ids.target },
      });
      expect(member.role).toBe("OPERATOR");
    });

    it("una acción fallida no deja evento de éxito", async () => {
      const before = (await events({ action: "user.created" })).length;
      await call("post", "/users", await session(emails.admin)).send({
        name: "Duplicado",
        email: emails.operator,
        password: "contrasena-inicial-1",
        role: "OPERATOR",
      });
      expect(await events({ action: "user.created" })).toHaveLength(before);
    });

    it("ningún evento contiene contraseñas, hashes ni credenciales", async () => {
      const all = await db.database.prisma.auditEvent.findMany();
      const serialized = JSON.stringify(all);
      for (const secret of [
        PASSWORD,
        "contrasena-inicial-1",
        "establecida-por-admin-1",
        "$scrypt",
        "session",
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });
  });
});

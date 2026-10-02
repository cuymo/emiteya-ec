// Contexto de petición (design D3) y autorización en el orden de D4, con un router de prueba que
// usa el middleware y el autorizador reales.
import { Router } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userSchemas } from "@facturador/contracts";
import {
  createAuthorizer,
  parseInput,
} from "../../src/modules/identity/application/authorization.ts";
import { contextOf } from "../../src/modules/identity/infrastructure/http/request-context.ts";
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

const schemas = userSchemas();

type Body = { error: { code: string; message: string }; data: Record<string, string> };
const errorOf = (res: { body: unknown }) => (res.body as Body).error;
const dataOf = (res: { body: unknown }) => (res.body as Body).data;

describe("contexto de petición y autorización", () => {
  let db: MigratedSchema;
  let harness: AuthApp;
  let companyA: string;
  let companyB: string;
  let operatorA: string;
  let userB: string;
  const emails = {
    admin: "admin@a.ec",
    operator: "operador@a.ec",
    promoted: "promovido@a.ec",
    deactivated: "desactivado@a.ec",
    orphan: "sin-membresia@a.ec",
    adminB: "admin@b.ec",
  };

  beforeAll(async () => {
    db = await createMigratedSchema("request_context");
    companyA = await insertCompany(db.database.prisma, "Empresa A");
    companyB = await insertCompany(db.database.prisma, "Empresa B");
    harness = buildAuthApp(db, {
      apiRouter: ({ context, memberships, securityEvents }) => {
        const authorizer = createAuthorizer({ memberships, securityEvents });
        const router = Router();
        router.use(context);
        // Devuelve el contexto que evaluó el servidor.
        router.get("/probe/context", (_req, res) => {
          const ctx = contextOf(res);
          res.json({ data: { companyId: ctx.companyId, role: ctx.role, userId: ctx.userId } });
        });
        // Operación reservada al administrador, con cuerpo estricto: permiso antes que validación.
        router.post("/probe/admin", (req, res) => {
          const ctx = contextOf(res);
          authorizer.requirePermission(ctx, "users.changeRole");
          res.json({ data: parseInput(schemas.changeRole, req.body) });
        });
        // Operación sobre un usuario objetivo: permiso, pertenencia y validación.
        router.put("/probe/users/:userId/role", async (req, res) => {
          const ctx = contextOf(res);
          const target = await authorizer.requireMember(ctx, "users.changeRole", req.params.userId);
          res.json({
            data: { target: target.userId, ...parseInput(schemas.changeRole, req.body) },
          });
        });
        return router;
      },
    });
    await createMember(harness.uow, companyA, {
      name: "Admin",
      email: emails.admin,
      role: "ADMIN",
    });
    operatorA = await createMember(harness.uow, companyA, {
      name: "Operador",
      email: emails.operator,
    });
    await createMember(harness.uow, companyA, { name: "Promovido", email: emails.promoted });
    await createMember(harness.uow, companyA, { name: "Desactivado", email: emails.deactivated });
    userB = await createMember(harness.uow, companyB, {
      name: "Admin B",
      email: emails.adminB,
      role: "ADMIN",
    });
  });

  afterAll(async () => {
    await db.drop();
  });

  const session = async (email: string) => {
    const { cookie, status } = await signIn(harness.app, email, PASSWORD);
    expect(status).toBe(200);
    return cookie;
  };
  const get = (url: string, cookie = "") =>
    request(harness.app).get(`/api/v1${url}`).set("Cookie", cookie);
  const post = (url: string, cookie: string) =>
    request(harness.app).post(`/api/v1${url}`).set("Origin", BASE_URL).set("Cookie", cookie);
  const put = (url: string, cookie: string) =>
    request(harness.app).put(`/api/v1${url}`).set("Origin", BASE_URL).set("Cookie", cookie);
  const auditCount = () => db.database.prisma.auditEvent.count();

  describe("sesión y membresía activa", () => {
    it("sin sesión responde 401 sin datos de la empresa", async () => {
      const res = await get("/probe/context");
      expect(res.status).toBe(401);
      expect(errorOf(res)).toMatchObject({ code: "UNAUTHENTICATED" });
      expect(JSON.stringify(res.body)).not.toContain(companyA);
    });

    it("una identidad con sesión pero sin membresía activa recibe el mismo 401", async () => {
      // La sesión se abre con membresía activa; luego la membresía desaparece.
      const userId = await createMember(harness.uow, companyA, {
        name: "Huérfano",
        email: emails.orphan,
      });
      const cookie = await session(emails.orphan);
      await db.database.prisma.member.delete({
        where: { organizationId_userId: { organizationId: companyA, userId } },
      });
      const withoutMembership = await get("/probe/context", cookie);
      const withoutSession = await get("/probe/context");
      expect(withoutMembership.status).toBe(401);
      expect(errorOf(withoutMembership).code).toBe(errorOf(withoutSession).code);
      expect(errorOf(withoutMembership).message).toBe(errorOf(withoutSession).message);
    });

    it("una cookie inventada no autoriza nada", async () => {
      const res = await get("/probe/context", "better-auth.session_token=inventado.firma");
      expect(res.status).toBe(401);
    });
  });

  describe("contexto derivado en el servidor", () => {
    it("companyId en la consulta o en una cabecera se ignora: rige la empresa de la sesión", async () => {
      const cookie = await session(emails.admin);
      const res = await get(`/probe/context?companyId=${companyB}`, cookie)
        .set("X-Company-Id", companyB)
        .set("X-Organization-Id", companyB);
      expect(res.status).toBe(200);
      expect(dataOf(res).companyId).toBe(companyA);
    });

    it("companyId en el cuerpo de una escritura se rechaza sin efectos", async () => {
      const cookie = await session(emails.admin);
      const res = await post("/probe/admin", cookie).send({ role: "ADMIN", companyId: companyB });
      expect(res.status).toBe(400);
      expect(errorOf(res).message).toBe("La solicitud contiene campos no permitidos.");
    });

    it("un rol en el cuerpo, la consulta o una cabecera no altera el permiso del operador", async () => {
      const cookie = await session(emails.operator);
      const res = await post("/probe/admin?role=ADMIN", cookie)
        .set("X-Role", "ADMIN")
        .set("X-User-Role", "ADMIN")
        .send({ role: "ADMIN" });
      expect(res.status).toBe(403);
      expect(
        dataOf(await get("/probe/context?role=ADMIN", cookie).set("X-Role", "ADMIN")).role,
      ).toBe("OPERATOR");
    });

    it("un cambio de rol rige en la siguiente petición con la misma sesión", async () => {
      const cookie = await session(emails.promoted);
      expect((await post("/probe/admin", cookie).send({ role: "OPERATOR" })).status).toBe(403);
      const userId = dataOf(await get("/probe/context", cookie)).userId as string;
      await harness.uow.run(({ identity }) =>
        identity.updateMembership(companyA, userId, { role: "ADMIN" }),
      );
      expect((await post("/probe/admin", cookie).send({ role: "OPERATOR" })).status).toBe(200);
    });

    it("un usuario desactivado se rechaza en su siguiente operación aunque su sesión exista", async () => {
      const cookie = await session(emails.deactivated);
      const userId = dataOf(await get("/probe/context", cookie)).userId as string;
      // Solo el estado: la sesión sigue en la base, y el filtro de D3 la rechaza igualmente.
      await db.database.prisma.member.update({
        where: { organizationId_userId: { organizationId: companyA, userId } },
        data: { status: "DEACTIVATED" },
      });
      expect(await db.database.prisma.session.count({ where: { userId } })).toBeGreaterThan(0);
      expect((await get("/probe/context", cookie)).status).toBe(401);
    });
  });

  describe("orden de la autorización", () => {
    it("un operador recibe 403 antes de cualquier error de validación, con evento de seguridad y sin auditoría", async () => {
      const cookie = await session(emails.operator);
      const before = await auditCount();
      harness.events.length = 0;
      const res = await post("/probe/admin", cookie).send({ role: "ROOT", extra: true });
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe("FORBIDDEN");
      expect(harness.events).toEqual([
        expect.objectContaining({
          type: "authorization_denied",
          status: 403,
          action: "users.changeRole",
          actorUserId: operatorA,
          companyId: companyA,
        }),
      ]);
      expect(await auditCount()).toBe(before);
    });

    it("un usuario de otra empresa responde 404 antes de validar el cuerpo, con evento de seguridad", async () => {
      const cookie = await session(emails.admin);
      harness.events.length = 0;
      const res = await put(`/probe/users/${userB}/role`, cookie).send({ invalido: true });
      expect(res.status).toBe(404);
      expect(errorOf(res).code).toBe("USER_NOT_FOUND");
      const nonexistent = await put("/probe/users/no-existe/role", cookie).send({ role: "ADMIN" });
      expect(nonexistent.status).toBe(404);
      expect(errorOf(nonexistent).message).toBe(errorOf(res).message);
      expect(harness.events.map((e) => e.type === "authorization_denied" && e.status)).toEqual([
        404, 404,
      ]);
    });

    it("con permiso y pertenencia, la validación decide al final", async () => {
      const cookie = await session(emails.admin);
      expect(
        (await put(`/probe/users/${operatorA}/role`, cookie).send({ role: "NINGUNO" })).status,
      ).toBe(400);
      const ok = await put(`/probe/users/${operatorA}/role`, cookie).send({ role: "ADMIN" });
      expect(ok.status).toBe(200);
      expect(dataOf(ok)).toEqual({ target: operatorA, role: "ADMIN" });
    });
  });
});

// Recuperación administrativa de emergencia (design D8).
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RecoveryError,
  recoverAdministrator,
} from "../../src/modules/identity/application/recovery.ts";
import { BACKEND_DIR, createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import {
  BASE_URL,
  PASSWORD,
  buildAuthApp,
  createMember,
  signIn,
  type AuthApp,
} from "./auth-harness.ts";

const NEW_PASSWORD = "recuperada-por-servidor-1";

describe("recuperación administrativa de emergencia", () => {
  let db: MigratedSchema;
  let harness: AuthApp;
  let companyId: string;
  let adminId: string;
  const admin = "admin@recuperacion.ec";
  const operator = "operador@recuperacion.ec";

  beforeAll(async () => {
    db = await createMigratedSchema("recovery");
    harness = buildAuthApp(db);
    companyId = await insertCompany(db.database.prisma, "Empresa");
    adminId = await createMember(harness.uow, companyId, {
      name: "Admin",
      email: admin,
      role: "ADMIN",
    });
    await createMember(harness.uow, companyId, { name: "Operador", email: operator });
  });

  afterAll(async () => {
    await db.drop();
  });

  const events = () => db.database.prisma.auditEvent.findMany({ where: { companyId } });

  it("recupera a un administrador desactivado: lo reactiva, cambia la contraseña y revoca sus sesiones", async () => {
    expect((await signIn(harness.app, admin, PASSWORD)).status).toBe(200);
    await db.database.prisma.member.update({
      where: { organizationId_userId: { organizationId: companyId, userId: adminId } },
      data: { status: "DEACTIVATED" },
    });

    const result = await recoverAdministrator(harness.uow, {
      email: admin,
      password: NEW_PASSWORD,
      correlationId: "recuperacion-1",
    });
    expect(result).toEqual({ userId: adminId, companyIds: [companyId], reactivated: true });

    const member = await db.database.prisma.member.findUniqueOrThrow({
      where: { organizationId_userId: { organizationId: companyId, userId: adminId } },
    });
    expect(member.status).toBe("ACTIVE");
    expect(await db.database.prisma.session.count({ where: { userId: adminId } })).toBe(0);
    expect((await signIn(harness.app, admin, PASSWORD)).status).toBe(401);
    expect((await signIn(harness.app, admin, NEW_PASSWORD)).status).toBe(200);

    const [event] = await events();
    expect(event).toMatchObject({
      actorType: "TECHNICAL_ADMIN",
      actorUserId: null,
      action: "user.recovered",
      targetUserId: adminId,
      changes: { reactivated: true },
      correlationId: "recuperacion-1",
    });
    expect(JSON.stringify(event)).not.toContain(NEW_PASSWORD);
  });

  it("con el correo de un operador falla y nada cambia", async () => {
    const before = await events();
    await expect(
      recoverAdministrator(harness.uow, {
        email: operator,
        password: NEW_PASSWORD,
        correlationId: "x",
      }),
    ).rejects.toMatchObject({ reason: "not_an_administrator" });
    expect((await signIn(harness.app, operator, PASSWORD)).status).toBe(200);
    expect(await events()).toHaveLength(before.length);
  });

  it("con un correo inexistente falla y nada cambia", async () => {
    const before = await events();
    await expect(
      recoverAdministrator(harness.uow, {
        email: "nadie@recuperacion.ec",
        password: NEW_PASSWORD,
        correlationId: "x",
      }),
    ).rejects.toBeInstanceOf(RecoveryError);
    expect(await events()).toHaveLength(before.length);
  });

  describe("comando admin:recover", () => {
    function command(email: string, stdin: string) {
      return spawnSync(
        process.execPath,
        ["--conditions=development", "src/commands/admin-recover.ts", "--email", email],
        {
          cwd: BACKEND_DIR,
          input: stdin,
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "development",
            DATABASE_URL: db.url,
            BETTER_AUTH_SECRET: "secreto-de-pruebas-0123456789abcdef0123",
            BETTER_AUTH_URL: BASE_URL,
          },
          encoding: "utf8",
          timeout: 90_000,
        },
      );
    }

    it("lee la contraseña de la entrada estándar y no la muestra", async () => {
      const password = "desde-la-entrada-estandar-1";
      const result = command(admin, `${password}\n`);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Administrador recuperado");
      expect(result.stdout + result.stderr).not.toContain(password);
      expect((await signIn(harness.app, admin, password)).status).toBe(200);
    });

    it("termina con error y sin cambios para un operador o un correo inexistente", async () => {
      const before = await events();
      const forOperator = command(operator, `${NEW_PASSWORD}\n`);
      expect(forOperator.status).toBe(1);
      expect(forOperator.stderr).toContain("No se cambió nada");
      expect(command("nadie@recuperacion.ec", `${NEW_PASSWORD}\n`).status).toBe(1);
      expect(await events()).toHaveLength(before.length);
    });

    it("rechaza una contraseña que no cumple la política", () => {
      const result = command(admin, "corta\n");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("entre 12 y 128 caracteres");
    });
  });

  describe("sin vía remota", () => {
    it("ningún archivo del servidor importa el comando ni el caso de uso de recuperación", () => {
      const src = join(BACKEND_DIR, "src");
      const files = readdirSync(src, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".ts") && !file.startsWith("generated"))
        .map((file) => join(src, file));
      const importers = files.filter((file) => {
        const rel = relative(src, file);
        if (rel.startsWith("commands") || rel.endsWith("application/recovery.ts")) return false;
        return /from\s+["'][^"']*(commands\/|application\/recovery)/.test(
          readFileSync(file, "utf8"),
        );
      });
      expect(importers).toEqual([]);
    });

    it("ninguna ruta HTTP ofrece la recuperación", async () => {
      const { app } = buildAuthApp(db);
      for (const path of [
        "/api/v1/admin/recover",
        "/api/v1/recover",
        "/api/v1/users/recover",
        "/api/auth/admin/recover",
        "/admin/recover",
      ]) {
        const res = await request(app)
          .post(path)
          .set("Origin", BASE_URL)
          .send({ email: admin, password: NEW_PASSWORD });
        expect(res.status, path).toBe(404);
      }
    });
  });
});

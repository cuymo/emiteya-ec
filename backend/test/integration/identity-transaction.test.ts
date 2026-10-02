// Unidad de trabajo de design D2: Better Auth y la auditoría escriben en la misma transacción.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { PASSWORD, buildAuthApp, createMember, signIn, type AuthApp } from "./auth-harness.ts";
import {
  EmailInUseError,
  PasswordPolicyError,
} from "../../src/modules/identity/application/unit-of-work.ts";

const AUDIT_FAILURE = new Error("fallo inyectado al auditar");

describe("transacción de Better Auth y auditoría", () => {
  let db: MigratedSchema;
  let companyId: string;
  let harness: AuthApp;

  beforeAll(async () => {
    db = await createMigratedSchema("identity_tx");
    companyId = await insertCompany(db.database.prisma, "Empresa");
    harness = buildAuthApp(db);
  });

  afterAll(async () => {
    await db.drop();
  });

  it("un fallo al auditar revierte el alta hecha con createUser: no queda usuario, cuenta ni membresía", async () => {
    const email = "revertido@tx.ec";
    await expect(
      harness.uow.run(async ({ identity, audit }) => {
        const userId = await identity.createUser({ name: "Revertido", email, password: PASSWORD });
        await identity.addMembership({ companyId, userId, role: "OPERATOR" });
        await audit.append({
          companyId,
          actor: { type: "SYSTEM" },
          action: "user.created",
          targetUserId: userId,
          correlationId: "tx-1",
        });
        throw AUDIT_FAILURE;
      }),
    ).rejects.toBe(AUDIT_FAILURE);

    const prisma = db.database.prisma;
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    expect(await prisma.account.count()).toBe(0);
    expect(await prisma.member.count()).toBe(0);
    expect(await prisma.auditEvent.count()).toBe(0);
  });

  it("un fallo al auditar revierte el cambio de contraseña hecho con auth.$context y conserva las sesiones", async () => {
    const email = "contrasena@tx.ec";
    const userId = await createMember(harness.uow, companyId, { name: "Con sesión", email });
    const session = await signIn(harness.app, email, PASSWORD);
    expect(session.status).toBe(200);

    await expect(
      harness.uow.run(async ({ identity }) => {
        await identity.setPassword(userId, "contrasena-nueva-123");
        throw AUDIT_FAILURE;
      }),
    ).rejects.toBe(AUDIT_FAILURE);

    expect((await signIn(harness.app, email, PASSWORD)).status).toBe(200);
    expect((await signIn(harness.app, email, "contrasena-nueva-123")).status).toBe(401);
    expect(await db.database.prisma.session.count({ where: { userId } })).toBeGreaterThan(0);
  });

  it("una contraseña establecida con éxito reemplaza la anterior e invalida todas las sesiones", async () => {
    const email = "exito@tx.ec";
    const userId = await createMember(harness.uow, companyId, { name: "Éxito", email });
    await signIn(harness.app, email, PASSWORD);
    await harness.uow.run(({ identity }) => identity.setPassword(userId, "contrasena-nueva-456"));
    expect(await db.database.prisma.session.count({ where: { userId } })).toBe(0);
    expect((await signIn(harness.app, email, PASSWORD)).status).toBe(401);
    expect((await signIn(harness.app, email, "contrasena-nueva-456")).status).toBe(200);
  });

  it("un correo existente con otra capitalización se rechaza como correo en uso", async () => {
    await createMember(harness.uow, companyId, { name: "Original", email: "dup@tx.ec" });
    await expect(
      harness.uow.run(({ identity }) =>
        identity.createUser({ name: "Duplicado", email: "DUP@tx.EC", password: PASSWORD }),
      ),
    ).rejects.toBeInstanceOf(EmailInUseError);
    expect(await db.database.prisma.user.count({ where: { email: "dup@tx.ec" } })).toBe(1);
  });

  it("el puerto exige la política de contraseñas aunque createUser no la aplique", async () => {
    await expect(
      harness.uow.run(({ identity }) =>
        identity.createUser({ name: "Corta", email: "corta@tx.ec", password: "a".repeat(11) }),
      ),
    ).rejects.toBeInstanceOf(PasswordPolicyError);
    expect(await db.database.prisma.user.count({ where: { email: "corta@tx.ec" } })).toBe(0);
  });

  it("actualizar una membresía de otra empresa falla y no cambia nada", async () => {
    const other = await insertCompany(db.database.prisma, "Otra");
    const userId = await createMember(harness.uow, companyId, {
      name: "Ajeno",
      email: "ajeno@tx.ec",
    });
    await expect(
      harness.uow.run(({ identity }) =>
        identity.updateMembership(other, userId, { role: "ADMIN" }),
      ),
    ).rejects.toThrow();
    const member = await db.database.prisma.member.findUnique({
      where: { organizationId_userId: { organizationId: companyId, userId } },
    });
    expect(member?.role).toBe("OPERATOR");
  });
});

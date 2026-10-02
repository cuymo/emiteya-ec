import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember, type InsertedMember } from "./fixtures.ts";

describe("repositorios de membresía y auditoría con dos empresas", () => {
  let db: MigratedSchema;
  let companyA: string;
  let companyB: string;
  let adminA: InsertedMember;
  let operatorA: InsertedMember;
  let inactiveA: InsertedMember;
  let adminB: InsertedMember;
  let operatorB: InsertedMember;

  beforeAll(async () => {
    db = await createMigratedSchema("repositories");
    const prisma = db.database.prisma;
    companyA = await insertCompany(prisma, "Empresa A");
    companyB = await insertCompany(prisma, "Empresa B");
    adminA = await insertMember(prisma, companyA, {
      name: "Ana Admin",
      role: "ADMIN",
      email: "ana@a.ec",
    });
    operatorA = await insertMember(prisma, companyA, {
      name: "Óscar Operador",
      email: "oscar@a.ec",
    });
    inactiveA = await insertMember(prisma, companyA, {
      name: "Inés Inactiva",
      email: "ines@a.ec",
      status: "DEACTIVATED",
    });
    adminB = await insertMember(prisma, companyB, {
      name: "Ana Bravo",
      role: "ADMIN",
      email: "ana@b.ec",
    });
    operatorB = await insertMember(prisma, companyB, { name: "Beto 100% B", email: "beto_b@b.ec" });
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("membresías", () => {
    it("resuelve la membresía activa del usuario de la sesión, y nada para uno desactivado", async () => {
      const members = createMembershipReader(db.database.prisma);
      expect(await members.findActiveForSessionUser(operatorA.userId)).toEqual({
        userId: operatorA.userId,
        companyId: companyA,
        role: "OPERATOR",
        status: "ACTIVE",
      });
      expect(await members.findActiveForSessionUser(inactiveA.userId)).toBeNull();
      expect(await members.findActiveForSessionUser("no-existe")).toBeNull();
    });

    it("un usuario de otra empresa no existe para la empresa del contexto", async () => {
      const members = createMembershipReader(db.database.prisma);
      expect(await members.findInCompany(companyA, adminB.userId)).toBeNull();
      expect(await members.findInCompany(companyB, operatorA.userId)).toBeNull();
      expect(await members.findInCompany(companyA, operatorA.userId)).toMatchObject({
        userId: operatorA.userId,
        companyId: companyA,
        name: "Óscar Operador",
        email: "oscar@a.ec",
        role: "OPERATOR",
        status: "ACTIVE",
      });
    });

    it("la lista solo contiene usuarios de la empresa del contexto, activos y desactivados", async () => {
      const members = createMembershipReader(db.database.prisma);
      const page = await members.listInCompany(companyA, { page: 1, pageSize: 25 });
      expect(page.total).toBe(3);
      expect(page.items.map((m) => m.userId).sort()).toEqual(
        [adminA.userId, operatorA.userId, inactiveA.userId].sort(),
      );
      expect(page.items.every((m) => m.companyId === companyA)).toBe(true);
    });

    it("busca por nombre o correo sin distinguir mayúsculas y sin salir de la empresa", async () => {
      const members = createMembershipReader(db.database.prisma);
      const byName = await members.listInCompany(companyA, {
        search: "ANA",
        page: 1,
        pageSize: 25,
      });
      expect(byName.items.map((m) => m.userId)).toEqual([adminA.userId]);
      const byEmail = await members.listInCompany(companyA, {
        search: "@a.EC",
        page: 1,
        pageSize: 25,
      });
      expect(byEmail.total).toBe(3);
      const otherCompany = await members.listInCompany(companyA, {
        search: "Bravo",
        page: 1,
        pageSize: 25,
      });
      expect(otherCompany).toEqual({ items: [], total: 0 });
    });

    it("trata los comodines de la búsqueda como texto", async () => {
      const members = createMembershipReader(db.database.prisma);
      expect(
        (await members.listInCompany(companyA, { search: "%", page: 1, pageSize: 25 })).total,
      ).toBe(0);
      expect(
        (await members.listInCompany(companyA, { search: "_", page: 1, pageSize: 25 })).total,
      ).toBe(0);
      expect(
        (await members.listInCompany(companyB, { search: "100%", page: 1, pageSize: 25 })).items,
      ).toEqual([expect.objectContaining({ userId: operatorB.userId })]);
    });

    it("filtra por estado y pagina en el servidor", async () => {
      const members = createMembershipReader(db.database.prisma);
      const inactive = await members.listInCompany(companyA, {
        status: "DEACTIVATED",
        page: 1,
        pageSize: 25,
      });
      expect(inactive.items.map((m) => m.userId)).toEqual([inactiveA.userId]);
      const first = await members.listInCompany(companyA, { page: 1, pageSize: 2 });
      const second = await members.listInCompany(companyA, { page: 2, pageSize: 2 });
      expect(first.items).toHaveLength(2);
      expect(second.items).toHaveLength(1);
      expect(first.total).toBe(3);
      expect(new Set([...first.items, ...second.items].map((m) => m.userId)).size).toBe(3);
    });
  });

  describe("auditoría", () => {
    it("registra el evento en la empresa indicada y nunca lo muestra a otra", async () => {
      const audit = createAuditLog(db.database.prisma);
      await audit.append({
        companyId: companyA,
        actor: { type: "USER", userId: adminA.userId },
        action: "user.role_changed",
        targetUserId: operatorA.userId,
        changes: { from: "OPERATOR", to: "ADMIN" },
        correlationId: "req-a-1",
      });
      await audit.append({
        companyId: companyB,
        actor: { type: "SYSTEM" },
        action: "company.provisioned",
        targetUserId: adminB.userId,
        correlationId: "req-b-1",
      });

      const eventsA = await audit.listForCompany(companyA);
      expect(eventsA).toHaveLength(1);
      expect(eventsA[0]).toMatchObject({
        companyId: companyA,
        actor: { type: "USER", userId: adminA.userId },
        action: "user.role_changed",
        targetUserId: operatorA.userId,
        changes: { from: "OPERATOR", to: "ADMIN" },
        correlationId: "req-a-1",
      });
      const eventsB = await audit.listForCompany(companyB);
      expect(eventsB.map((e) => e.companyId)).toEqual([companyB]);
      expect(eventsB[0]?.actor).toEqual({ type: "SYSTEM" });
    });

    it("rechaza cambios con campos que sugieren un secreto", async () => {
      const audit = createAuditLog(db.database.prisma);
      await expect(
        audit.append({
          companyId: companyA,
          actor: { type: "USER", userId: adminA.userId },
          action: "user.password_set",
          targetUserId: operatorA.userId,
          changes: { newPassword: "no-debe-guardarse" },
          correlationId: "req-a-2",
        }),
      ).rejects.toThrow(/secreto/);
      expect(await audit.listForCompany(companyA)).toHaveLength(1);
    });

    it("la base rechaza un actor USER sin usuario o un actor de sistema con usuario", async () => {
      const prisma = db.database.prisma;
      const base = { companyId: companyA, action: "user.created", correlationId: "c" };
      await expect(
        prisma.auditEvent.create({ data: { ...base, actorType: "USER" } }),
      ).rejects.toThrow();
      await expect(
        prisma.auditEvent.create({
          data: { ...base, actorType: "SYSTEM", actorUserId: adminA.userId },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.auditEvent.create({ data: { ...base, actorType: "ROBOT" } }),
      ).rejects.toThrow();
    });

    it("solo ofrece agregar y leer por empresa", () => {
      expect(Object.keys(createAuditLog(db.database.prisma)).sort()).toEqual([
        "append",
        "listForCompany",
      ]);
      expect(Object.keys(createMembershipReader(db.database.prisma)).sort()).toEqual([
        "findActiveForSessionUser",
        "findInCompany",
        "listInCompany",
      ]);
    });
  });

  describe("restricciones de membresía", () => {
    it("la base rechaza una segunda membresía del mismo usuario en la misma empresa", async () => {
      await expect(
        db.database.prisma.member.create({
          data: {
            id: "dup",
            organizationId: companyA,
            userId: operatorA.userId,
            role: "ADMIN",
            status: "ACTIVE",
            createdAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it("la base rechaza un rol o un estado fuera del dominio", async () => {
      const prisma = db.database.prisma;
      const user = await insertMember(prisma, companyB, { name: "Temporal" });
      await expect(
        prisma.member.update({
          where: { organizationId_userId: { organizationId: companyB, userId: user.userId } },
          data: { role: "member" },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.member.update({
          where: { organizationId_userId: { organizationId: companyB, userId: user.userId } },
          data: { status: "BANNED" },
        }),
      ).rejects.toThrow();
    });
  });
});

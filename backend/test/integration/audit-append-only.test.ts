import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";

describe("auditoría de solo agregado", () => {
  let db: MigratedSchema;
  let companyId: string;
  // El SQL crudo no recibe el esquema del adapter: se califica con el esquema aislado de la prueba.
  const table = () => `"${db.name}".audit_event`;

  beforeAll(async () => {
    db = await createMigratedSchema("audit_append_only");
    companyId = await insertCompany(db.database.prisma, "Empresa");
    await createAuditLog(db.database.prisma).append({
      companyId,
      actor: { type: "SYSTEM" },
      action: "company.provisioned",
      correlationId: "inicial",
    });
  });

  afterAll(async () => {
    await db.drop();
  });

  it("UPDATE falla y el evento permanece intacto", async () => {
    const prisma = db.database.prisma;
    await expect(
      prisma.$executeRawUnsafe(`UPDATE ${table()} SET action = 'user.created'`),
    ).rejects.toThrow(/solo agregado/);
    await expect(
      prisma.auditEvent.updateMany({ where: { companyId }, data: { correlationId: "otro" } }),
    ).rejects.toThrow(/solo agregado/);
    const [event] = await createAuditLog(prisma).listForCompany(companyId);
    expect(event).toMatchObject({ action: "company.provisioned", correlationId: "inicial" });
  });

  it("DELETE falla y el evento sigue existiendo", async () => {
    const prisma = db.database.prisma;
    await expect(prisma.$executeRawUnsafe(`DELETE FROM ${table()}`)).rejects.toThrow(
      /solo agregado/,
    );
    await expect(prisma.auditEvent.deleteMany({ where: { companyId } })).rejects.toThrow(
      /solo agregado/,
    );
    expect(await prisma.auditEvent.count()).toBe(1);
  });

  it("TRUNCATE falla", async () => {
    await expect(db.database.prisma.$executeRawUnsafe(`TRUNCATE ${table()}`)).rejects.toThrow(
      /solo agregado/,
    );
    expect(await db.database.prisma.auditEvent.count()).toBe(1);
  });

  it("borrar la empresa con auditoría falla por la clave foránea RESTRICT", async () => {
    await expect(
      db.database.prisma.organization.delete({ where: { id: companyId } }),
    ).rejects.toThrow();
  });
});

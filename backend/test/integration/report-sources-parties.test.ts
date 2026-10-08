// Fuente de Terceros y ambiente vigente para los reportes (add-reports-export, tarea 3.4, design D3 y
// D4): los filtros por rol, identificación y estado (activos por defecto en el contrato), los datos
// vigentes, el orden por razón social normalizada, el conteo, el cursor, el aislamiento por empresa y
// el ambiente de la configuración actual de la empresa.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PartiesFilters } from "@facturador/contracts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import { createPartiesReportSource } from "../../src/modules/parties/infrastructure/index.ts";
import { createTaxpayerConfiguration } from "../../src/modules/taxpayer/application/taxpayer-configuration.ts";
import { currentEnvironment } from "../../src/modules/taxpayer/infrastructure/index.ts";
import { createCompanyConfigRepository } from "../../src/modules/taxpayer/infrastructure/prisma-company-config.ts";
import { createTaxpayerUnitOfWork } from "../../src/modules/taxpayer/infrastructure/unit-of-work.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { allBatches, allPages } from "./reports-harness.ts";
import { insertGuideParty } from "./shipping-guide-harness.ts";

const ACTIVE: PartiesFilters = { status: "ACTIVE" };

describe("fuente de Terceros y ambiente vigente", () => {
  let db: MigratedSchema;
  let source: ReturnType<typeof createPartiesReportSource>;
  let a: FiscalCompany;
  let b: FiscalCompany;
  const id = {} as Record<"maria" | "andes" | "zoila" | "inactive" | "other", string>;

  beforeAll(async () => {
    db = await createMigratedSchema("report_sources_parties");
    source = createPartiesReportSource(db.name);
    const prisma = db.database.prisma;
    a = await insertFiscalCompany(prisma, "Empresa A", 1);
    b = await insertFiscalCompany(prisma, "Empresa B", 1);
    id.maria = await insertGuideParty(prisma, a, "0102030405", {
      legalName: "María Pérez",
      roles: ["CUSTOMER"],
    });
    id.andes = await insertGuideParty(prisma, a, "1790012345001", {
      legalName: "Andes Cía. Ltda.",
      roles: ["SUPPLIER", "CARRIER"],
    });
    id.zoila = await insertGuideParty(prisma, a, "0912345678", {
      legalName: '=HYPERLINK("http://ejemplo.invalid")',
      roles: ["SUPPLIER"],
    });
    id.inactive = await insertGuideParty(prisma, a, "0923456789", {
      legalName: "Bodega Cerrada",
      roles: ["SUPPLIER"],
    });
    await prisma.party.update({ where: { id: id.inactive }, data: { status: "INACTIVE" } });
    id.other = await insertGuideParty(prisma, b, "0102030405", { legalName: "María de B" });
    // Datos vigentes: el correo corregido.
    await prisma.party.update({
      where: { id: id.maria },
      data: { email: "maria@ejemplo.ec", phone: "0991234567" },
    });
    // La empresa A pasa a Producción; la B no tiene configuración.
    const admin = {
      userId: a.adminId,
      companyId: a.companyId,
      role: "ADMIN" as const,
      requestId: randomUUID(),
    };
    const configuration = createTaxpayerConfiguration({
      uow: createTaxpayerUnitOfWork(prisma),
      configs: createCompanyConfigRepository(prisma),
      authorizer: createAuthorizer({
        memberships: createMembershipReader(prisma),
        securityEvents: { emit: () => undefined },
      }),
    });
    await configuration.updateProfile(admin, {
      ruc: "1790012345001",
      legalName: "Comercial Andina S.A.",
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      accountingRequired: true,
      expectedVersion: null,
    });
    await configuration.changeEnvironment(admin, { environment: "PRODUCTION", expectedVersion: 1 });
  }, 180_000);

  afterAll(async () => {
    await db?.drop();
  });

  const rows = (filters: Partial<PartiesFilters> = {}, companyId = a.companyId) =>
    allPages(db.database.prisma, source, companyId, { ...ACTIVE, ...filters });
  const ids = (list: readonly { id: string }[]) => list.map((row) => row.id);

  it("lista los terceros activos con sus datos vigentes, por razón social normalizada", async () => {
    const list = await rows();
    // Los terceros del sistema (el consumidor final) también son terceros de la empresa.
    const own = list.filter((row) => Object.values(id).includes(row.id));
    expect(ids(own)).toEqual([id.zoila, id.andes, id.maria]);
    expect(own.find((row) => row.id === id.maria)).toEqual({
      id: id.maria,
      identification: "0102030405",
      legalName: "María Pérez",
      email: "maria@ejemplo.ec",
      phone: "0991234567",
      roles: ["CUSTOMER"],
      status: "ACTIVE",
    });
    expect(ids(list)).not.toContain(id.inactive);
    expect(await source.count(db.database.prisma, a.companyId, ACTIVE)).toBe(list.length);
  });

  it("filtra por rol, identificación y estado", async () => {
    expect(ids(await rows({ role: "SUPPLIER" }))).toEqual([id.zoila, id.andes]);
    expect((await rows({ role: "SUPPLIER" }))[1]?.roles).toEqual(["SUPPLIER", "CARRIER"]);
    expect(ids(await rows({ identification: "0102030405" }))).toEqual([id.maria]);
    expect(ids(await rows({ status: "INACTIVE" }))).toEqual([id.inactive]);
    expect(ids(await rows({ status: "ALL", role: "SUPPLIER" }))).toEqual([
      id.zoila,
      id.andes,
      id.inactive,
    ]);
  });

  it("recorre con el cursor las mismas filas que las páginas", async () => {
    const prisma = db.database.prisma;
    const filters: PartiesFilters = { status: "ALL" };
    const pages = await allPages(prisma, source, a.companyId, filters, 2);
    const cursor = await allBatches(prisma, source, a.companyId, filters, 2);
    expect(cursor.rows).toEqual(pages);
    expect(cursor.count).toBe(pages.length);
  });

  it("aísla cada empresa", async () => {
    expect(ids(await rows({ identification: "0102030405" }, b.companyId))).toEqual([id.other]);
    expect(ids(await rows({ status: "ALL" }))).not.toContain(id.other);
  });

  it("lee el ambiente de la configuración actual de la empresa, Pruebas sin configuración", async () => {
    const prisma = db.database.prisma;
    expect(await currentEnvironment(prisma, a.companyId)).toBe("PRODUCTION");
    expect(await currentEnvironment(prisma, b.companyId)).toBe("TEST");
  });
});

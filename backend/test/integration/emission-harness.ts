// Arnés de la emisión de facturas (add-invoice-emission): una empresa lista para emitir, con su
// configuración tributaria, un establecimiento con su punto, la firma sintética cargada con
// custodia, terceros y productos. Escribe la configuración, los puntos y los terceros directamente;
// la firma se carga por el servicio real, con su inspección en el pool criptográfico.
import { randomInt, randomUUID } from "node:crypto";
import type { CertificateCustodyConfig } from "../../src/config/env.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import { createProductRepository } from "../../src/modules/products/infrastructure/prisma-products.ts";
import { signingModule } from "../../src/modules/signing/infrastructure/index.ts";
import type { TaxpayerProfile } from "../../src/modules/taxpayer/domain/taxpayer-config.ts";
import { createTaxpayerScope } from "../../src/modules/taxpayer/infrastructure/index.ts";
import type { CryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import { createMember, type AuthApp } from "./auth-harness.ts";
import type { MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { sessionCookie } from "./taxpayer-harness.ts";

export const CUSTODY: CertificateCustodyConfig = {
  enabled: true,
  keyVersion: "1",
  key: Buffer.alloc(32, 7),
};

export type ProductSpec = {
  unitPrice: string;
  iva?: string;
  ice?: string | null;
  name?: string;
  mainCode?: string | null;
};

export type ReadyCompany = {
  companyId: string;
  adminId: string;
  operatorId: string;
  cookies: { admin: string; operator: string };
  establishmentId: string;
  emissionPointId: string;
  consumerFinalId: string;
  customerId: string;
  supplierId: string;
  /** Producto con IVA del 15 % y precio 8.75. */
  productId: string;
};

export const profileOf = (overrides: Partial<TaxpayerProfile> = {}): TaxpayerProfile => ({
  ruc: FIXTURE_RUC,
  legalName: "COMERCIAL ANDINA S.A.",
  tradeName: null,
  headOfficeAddress: "Av. Amazonas N24-03, Quito",
  phone: null,
  email: null,
  accountingRequired: true,
  specialTaxpayerNumber: null,
  withholdingAgentResolution: null,
  largeTaxpayer: false,
  rimpeCategory: null,
  providerRuc: null,
  ...overrides,
});

export async function createProduct(
  db: MigratedSchema,
  company: { companyId: string; adminId: string },
  spec: ProductSpec,
): Promise<string> {
  const product = await db.database.prisma.$transaction((tx) =>
    createProductRepository(tx).create(
      company.companyId,
      {
        kind: "GOOD",
        mainCode: spec.mainCode ?? null,
        auxiliaryCode: null,
        name: spec.name ?? `Producto ${randomUUID().slice(0, 6)}`,
        description: null,
        unitPrice: spec.unitPrice,
        stockTracked: false,
        taxes: { iva: spec.iva ?? "4", ice: spec.ice ?? null, irbpnr: null },
      },
      company.adminId,
    ),
  );
  return product.id;
}

/**
 * Empresa lista para emitir. Con `pool`, carga la firma sintética `sd-utf8.modern.p12` por el
 * servicio de la firma; sin él, la empresa no tiene firma.
 */
export async function readyCompany(
  api: AuthApp,
  db: MigratedSchema,
  options: {
    slug: string;
    pool?: CryptoWorkerPool;
    p12Dir?: string;
    profile?: Partial<TaxpayerProfile>;
  },
): Promise<ReadyCompany> {
  const prisma = db.database.prisma;
  const companyId = await insertCompany(prisma, `Empresa ${options.slug}`);
  const adminEmail = `admin@${options.slug}.ec`;
  const operatorEmail = `operador@${options.slug}.ec`;
  const adminId = await createMember(api.uow, companyId, {
    name: `Admin ${options.slug}`,
    email: adminEmail,
    role: "ADMIN",
  });
  const operatorId = await createMember(api.uow, companyId, {
    name: `Operador ${options.slug}`,
    email: operatorEmail,
    role: "OPERATOR",
  });
  await createTaxpayerScope(prisma).configs.appendVersion(companyId, {
    version: 1,
    config: { profile: profileOf(options.profile), environment: "TEST", logo: null },
    createdBy: adminId,
  });
  const establishment = await prisma.establishment.create({
    data: { companyId, code: "001", address: "Av. 6 de Diciembre, Quito" },
  });
  const point = await prisma.emissionPoint.create({
    data: { companyId, establishmentId: establishment.id, code: "001" },
  });
  if (options.pool) {
    await signingModule({
      prisma,
      authorizer: createAuthorizer({
        memberships: createMembershipReader(prisma),
        securityEvents: { emit: () => undefined },
      }),
      custody: CUSTODY,
      maxBytes: 64 * 1024,
      pool: options.pool,
    }).service.upload(
      { userId: adminId, companyId, role: "ADMIN", requestId: randomUUID() },
      {
        file: readFixture(options.p12Dir!, "sd-utf8.modern.p12").toString("base64"),
        password: FIXTURE_PASSWORD,
        expectedCurrentId: null,
      },
    );
  }
  const consumerFinal = await prisma.party.findFirstOrThrow({
    where: { companyId, systemRecord: "CONSUMER_FINAL" },
  });
  const partyData = (identification: string, legalName: string, roles: string[]) => ({
    companyId,
    identificationType: "04",
    identification,
    legalName,
    address: "Av. Quito y Guayaquil",
    roles,
    searchName: legalName.toLowerCase(),
    searchIdentification: identification,
    createdBy: adminId,
    updatedBy: adminId,
  });
  const customer = await prisma.party.create({
    data: partyData("0992877878001", "EL PERNO CIA. LTDA.", ["CUSTOMER"]),
  });
  const supplier = await prisma.party.create({
    data: partyData("1791234567001", "PROVEEDORA DEL SUR S.A.", ["SUPPLIER"]),
  });
  const productId = await createProduct(
    db,
    { companyId, adminId },
    { unitPrice: "8.75", name: "Cemento 50 kg", mainCode: "CEM-50" },
  );
  return {
    companyId,
    adminId,
    operatorId,
    cookies: {
      admin: await sessionCookie(api.app, adminEmail),
      operator: await sessionCookie(api.app, operatorEmail),
    },
    establishmentId: establishment.id,
    emissionPointId: point.id,
    consumerFinalId: consumerFinal.id,
    customerId: customer.id,
    supplierId: supplier.id,
    productId,
  };
}

/** Comprobante RESERVED con un número real, escrito directamente: para pruebas de la base. */
export async function insertReservedDocument(
  db: MigratedSchema,
  company: Pick<ReadyCompany, "companyId" | "adminId" | "establishmentId" | "emissionPointId">,
) {
  const prisma = db.database.prisma;
  const reservation = await createSequentialReservation(createFiscalUnitOfWork(prisma)).reserve({
    companyId: company.companyId,
    environment: "TEST",
    establishmentId: company.establishmentId,
    emissionPointId: company.emissionPointId,
    documentType: "01",
    reservedBy: company.adminId,
    correlationId: "prueba",
  });
  return prisma.electronicDocument.create({
    data: {
      companyId: company.companyId,
      documentType: "01",
      environment: "TEST",
      establishmentId: company.establishmentId,
      emissionPointId: company.emissionPointId,
      documentNumber: reservation.documentNumber,
      sequential: reservation.sequential,
      reservationId: reservation.reservationId,
      // Clave de prueba única, sin significado: estas pruebas no validan su composición.
      accessKey: Array.from({ length: 49 }, () => randomInt(10)).join(""),
      numericCode: "12345678",
      issueDate: new Date("2026-10-03"),
      state: "RESERVED",
      snapshot: { snapshotVersion: 1 },
      schemaVersion: "1.1.0",
      buyerIdentification: "0992877878001",
      buyerName: "EL PERNO CIA. LTDA.",
      total: "28.75",
      createdBy: company.adminId,
    },
  });
}

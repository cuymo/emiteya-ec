// Lecturas internas de la emisión de facturas (add-invoice-emission, tarea 5.1, design D1): cada
// módulo expone fábricas sobre un `DbClient` que la emisión compone dentro de su transacción de
// reserva. Leen solo datos de la empresa indicada y lo que escriben se revierte con la transacción.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  createFiscalScope,
  reserveSequentialIn,
} from "../../src/modules/fiscal/infrastructure/index.ts";
import { partyReader } from "../../src/modules/parties/infrastructure/index.ts";
import { productReader } from "../../src/modules/products/infrastructure/index.ts";
import { createProductRepository } from "../../src/modules/products/infrastructure/prisma-products.ts";
import { activeCertificateReader } from "../../src/modules/signing/application/active-certificate.ts";
import { createCertificateRepository } from "../../src/modules/signing/infrastructure/prisma-certificates.ts";
import {
  createTaxpayerScope,
  lockTaxIdentityIn,
  taxpayerEmissionReads,
} from "../../src/modules/taxpayer/infrastructure/index.ts";
import type { TaxpayerConfig } from "../../src/modules/taxpayer/domain/taxpayer-config.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";

const config = (ruc: string, legalName: string): TaxpayerConfig => ({
  profile: {
    ruc,
    legalName,
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
  },
  environment: "TEST",
  logo: null,
});

class Rollback extends Error {}

describe("lecturas internas de la emisión dentro de una transacción", () => {
  let db: MigratedSchema;
  let a: FiscalCompany;
  let b: FiscalCompany;
  const ids: Record<string, string> = {};

  /** Ejecuta `work` en una transacción y la revierte siempre. */
  async function inRolledBackTransaction(
    work: (
      tx: Parameters<Parameters<MigratedSchema["database"]["prisma"]["$transaction"]>[0]>[0],
    ) => Promise<void>,
  ) {
    await expect(
      db.database.prisma.$transaction(async (tx) => {
        await work(tx);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  }

  beforeAll(async () => {
    db = await createMigratedSchema("emission_reads");
    const prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    a = await insertFiscalCompany(prisma, "Empresa A", 1);
    b = await insertFiscalCompany(prisma, "Empresa B", 1);
    const scope = createTaxpayerScope(prisma);
    await scope.configs.appendVersion(a.companyId, {
      version: 1,
      config: config("1790012345001", "Comercial Andina S.A."),
      createdBy: a.adminId,
    });
    for (const [name, company] of [
      ["A", a],
      ["B", b],
    ] as const) {
      const party = await prisma.party.create({
        data: {
          companyId: company.companyId,
          identificationType: "04",
          identification: name === "A" ? "1790012345001" : "0992877878001",
          legalName: `Cliente ${name}`,
          roles: ["CUSTOMER"],
          searchName: `cliente ${name.toLowerCase()}`,
          searchIdentification: "x",
          createdBy: company.adminId,
          updatedBy: company.adminId,
        },
      });
      ids[`party${name}`] = party.id;
      // Producto e impuestos en una transacción, como exige su invariante diferida.
      const product = await prisma.$transaction((tx) =>
        createProductRepository(tx).create(
          company.companyId,
          {
            kind: "GOOD",
            mainCode: `P-${name}`,
            auxiliaryCode: null,
            name: `Producto ${name}`,
            description: null,
            unitPrice: "8.75",
            stockTracked: false,
            taxes: { iva: "4", ice: null, irbpnr: null },
          },
          company.adminId,
        ),
      );
      ids[`product${name}`] = product.id;
    }
    const certificate = await prisma.signingCertificate.create({
      data: {
        id: randomUUID(),
        companyId: a.companyId,
        status: "ACTIVE",
        activeCompanyId: a.companyId,
        subject: "CN=TITULAR",
        issuer: "CN=AC",
        serialNumber: "01",
        fingerprintSha256: randomBytes(32).toString("hex"),
        notBefore: new Date("2026-01-01T00:00:00Z"),
        notAfter: new Date("2027-01-01T00:00:00Z"),
        detectedRuc: "1790012345001",
        keyAlgorithm: "RSA",
        keyBits: 2048,
        uploadedBy: a.adminId,
      },
    });
    await prisma.signingCertificateSecret.create({
      data: {
        certificateId: certificate.id,
        companyId: a.companyId,
        formatVersion: 1,
        keyVersion: "1",
        keyCheck: randomBytes(32),
        wrappedKey: randomBytes(48),
        wrappedKeyNonce: randomBytes(12),
        p12Ciphertext: randomBytes(64),
        p12Nonce: randomBytes(12),
        passwordCiphertext: randomBytes(32),
        passwordNonce: randomBytes(12),
      },
    });
    ids.certificate = certificate.id;
    ids.fingerprint = certificate.fingerprintSha256;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("taxpayer: configuración vigente y punto con su establecimiento, por empresa", async () => {
    await inRolledBackTransaction(async (tx) => {
      const reads = taxpayerEmissionReads(tx);
      expect((await reads.currentConfig(a.companyId))?.config.profile.ruc).toBe("1790012345001");
      expect(await reads.currentConfig(b.companyId)).toBeNull();
      const point = a.points[0]!;
      expect(await reads.emissionPoint(a.companyId, point.emissionPointId)).toMatchObject({
        point: { id: point.emissionPointId, code: "001", status: "ACTIVE" },
        establishment: { id: point.establishmentId, code: "001", status: "ACTIVE" },
      });
      expect(await reads.emissionPoint(b.companyId, point.emissionPointId)).toBeNull();
    });
  });

  it("taxpayer: el bloqueo de la identidad dentro de la transacción se revierte con ella", async () => {
    await inRolledBackTransaction(async (tx) => {
      expect(await lockTaxIdentityIn(createTaxpayerScope(tx), a.companyId)).toBe(true);
      expect(await lockTaxIdentityIn(createTaxpayerScope(tx), a.companyId)).toBe(false);
    });
    const current = await createTaxpayerScope(db.database.prisma).configs.findCurrent(a.companyId);
    expect(current?.taxIdentityLocked).toBe(false);
  });

  it("fiscal: la reserva dentro de la transacción se revierte con ella", async () => {
    const point = a.points[0]!;
    const input = {
      companyId: a.companyId,
      environment: "TEST" as const,
      establishmentId: point.establishmentId,
      emissionPointId: point.emissionPointId,
      documentType: "01" as const,
      reservedBy: a.adminId,
      correlationId: randomUUID(),
    };
    await inRolledBackTransaction(async (tx) => {
      const reservation = await reserveSequentialIn(createFiscalScope(tx), input);
      expect(reservation).toMatchObject({ sequential: 1, documentNumber: "001-001-000000001" });
    });
    expect(await db.database.prisma.fiscalSequenceReservation.count()).toBe(0);
    await expect(
      db.database.prisma.$transaction((tx) =>
        reserveSequentialIn(createFiscalScope(tx), { ...input, companyId: b.companyId }),
      ),
    ).rejects.toMatchObject({ code: "EMISSION_POINT_NOT_FOUND" });
  });

  it("parties y products: leen solo terceros y productos de la empresa", async () => {
    await inRolledBackTransaction(async (tx) => {
      expect(await partyReader(tx).find(a.companyId, ids.partyA!)).toMatchObject({
        legalName: "Cliente A",
        roles: ["CUSTOMER"],
        status: "ACTIVE",
      });
      expect(await partyReader(tx).find(a.companyId, ids.partyB!)).toBeNull();
      expect(await productReader(tx).find(a.companyId, ids.productA!)).toMatchObject({
        name: "Producto A",
        unitPrice: "8.75",
        taxes: { iva: "4", ice: null, irbpnr: null },
      });
      expect(await productReader(tx).find(b.companyId, ids.productA!)).toBeNull();
    });
  });

  it("signing: id, huella y si la firma vigente es utilizable, por empresa", async () => {
    const now = () => new Date("2026-10-03T12:00:00Z");
    await inRolledBackTransaction(async (tx) => {
      const certificates = createCertificateRepository(tx);
      const opens = activeCertificateReader({ certificates, vault: { canOpen: () => true }, now });
      expect(await opens.activeCertificate(a.companyId)).toEqual({
        id: ids.certificate,
        fingerprint: ids.fingerprint,
        usable: true,
      });
      expect(await opens.activeCertificate(b.companyId)).toBeNull();
      // Sin custodia que abra el secreto, o vencida, no es utilizable.
      const closed = activeCertificateReader({ certificates, vault: null, now });
      expect((await closed.activeCertificate(a.companyId))?.usable).toBe(false);
      const later = activeCertificateReader({
        certificates,
        vault: { canOpen: () => true },
        now: () => new Date("2027-01-02T00:00:00Z"),
      });
      expect((await later.activeCertificate(a.companyId))?.usable).toBe(false);
    });
  });
});

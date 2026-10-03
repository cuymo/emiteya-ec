// Invariantes de la migración add_fiscal_catalogs en PostgreSQL (design D4, D8, D9 y D14): datos
// del sistema sin borrado, versiones publicadas inmutables salvo cerrar una vigencia o retirarla,
// sin superposición, columnas tipadas por catálogo y habilitación solo de catálogos habilitables.
// Escribe directamente en las tablas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

const SOURCE = {
  sourceDocument: "Ficha técnica de comprobantes electrónicos, esquema offline",
  sourceVersion: "2.34",
  sourcePublishedOn: new Date("2026-07-27"),
  sourceUrl: "https://www.sri.gob.ec/facturacion-electronica",
  sourceSha256: "a".repeat(64),
  checksum: "b".repeat(64),
};

describe("invariantes de los catálogos fiscales en la base de datos", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let companyA: string;
  let userA: string;
  let ivaFifteen: string;

  const table = (name: string) => `"${db.name}"."${name}"`;
  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const iva = (overrides: Record<string, unknown> = {}) => ({
    catalogType: "iva-rate",
    entryKey: "4",
    officialLabel: "15%",
    effectiveFrom: new Date("2026-07-27"),
    effectiveFromBasis: "PROJECT_BASELINE",
    normativeStatus: "OFFICIAL",
    sourceRef: "Tabla 17, página 30",
    datasetVersion: 1,
    taxKind: "IVA",
    sriTaxCode: "2",
    rateKind: "PERCENTAGE",
    percentage: "15.00",
    ...overrides,
  });

  beforeAll(async () => {
    db = await createMigratedSchema("fiscal_catalogs_schema");
    prisma = db.database.prisma;
    companyA = await insertCompany(prisma, "Empresa A");
    userA = (await insertMember(prisma, companyA, { name: "Admin A", role: "ADMIN" })).userId;
    for (const [catalogType, enablementPolicy] of [
      ["iva-rate", "DEFAULT_ENABLED"],
      ["ice-rate", "DEFAULT_DISABLED"],
      ["identification-type", "NOT_ENABLEABLE"],
    ] as const) {
      await prisma.fiscalCatalogDataset.create({
        data: { catalogType, version: 1, enablementPolicy, ...SOURCE },
      });
    }
    await prisma.fiscalCatalogKey.createMany({
      data: [
        { catalogType: "iva-rate", entryKey: "4", code: "4" },
        { catalogType: "iva-rate", entryKey: "8", code: "8" },
        { catalogType: "ice-rate", entryKey: "3041-GRAN-ESCALA", code: "3041" },
        { catalogType: "ice-rate", entryKey: "3041-MEDIANA-ESCALA", code: "3041" },
        { catalogType: "identification-type", entryKey: "04", code: "04" },
      ],
    });
    ivaFifteen = (await prisma.fiscalCatalogEntry.create({ data: iva() })).id;
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("datasets y claves", () => {
    it("exigen la política de habilitación que corresponde al catálogo", async () => {
      expect(
        await fails(
          prisma.fiscalCatalogDataset.create({
            data: {
              catalogType: "tax",
              version: 1,
              enablementPolicy: "DEFAULT_ENABLED",
              ...SOURCE,
            },
          }),
        ),
      ).toContain("fiscal_catalog_dataset_enablement_policy_check");
      expect(
        await fails(
          prisma.fiscalCatalogDataset.create({
            data: {
              catalogType: "payment-method",
              version: 1,
              enablementPolicy: "NOT_ENABLEABLE",
              ...SOURCE,
            },
          }),
        ),
      ).toContain("fiscal_catalog_dataset_enablement_policy_check");
    });

    it("rechazan una versión repetida, actualizar o borrar un dataset", async () => {
      expect(
        await fails(
          prisma.fiscalCatalogDataset.create({
            data: {
              catalogType: "iva-rate",
              version: 1,
              enablementPolicy: "DEFAULT_ENABLED",
              ...SOURCE,
            },
          }),
        ),
      ).toMatch(/Unique constraint|unique/i);
      expect(
        await fails(
          prisma.$executeRawUnsafe(
            `UPDATE ${table("fiscal_catalog_dataset")} SET checksum = '${"c".repeat(64)}'`,
          ),
        ),
      ).toContain("no admite UPDATE");
      expect(
        await fails(prisma.$executeRawUnsafe(`DELETE FROM ${table("fiscal_catalog_dataset")}`)),
      ).toContain("no admite DELETE");
      expect(
        await fails(
          prisma.$executeRawUnsafe(`TRUNCATE ${table("fiscal_catalog_dataset")} CASCADE`),
        ),
      ).toContain("no admite TRUNCATE");
    });

    it("el código no es identidad: dos claves comparten el código 3041", async () => {
      const keys = await prisma.fiscalCatalogKey.findMany({ where: { code: "3041" } });
      expect(keys.map((key) => key.entryKey).sort()).toEqual([
        "3041-GRAN-ESCALA",
        "3041-MEDIANA-ESCALA",
      ]);
    });

    it("validan el patrón de entryKey y de código, y no admiten cambios", async () => {
      expect(
        await fails(
          prisma.fiscalCatalogKey.create({
            data: { catalogType: "ice-rate", entryKey: "3041 gran", code: "3041" },
          }),
        ),
      ).toContain("fiscal_catalog_key_entry_key_check");
      expect(
        await fails(
          prisma.fiscalCatalogKey.create({
            data: { catalogType: "ice-rate", entryKey: "X1", code: "30411" },
          }),
        ),
      ).toContain("fiscal_catalog_key_code_check");
      expect(
        await fails(
          prisma.$executeRawUnsafe(
            `UPDATE ${table("fiscal_catalog_key")} SET code = '9' WHERE entry_key = '4'`,
          ),
        ),
      ).toContain("no admite UPDATE");
    });
  });

  describe("versiones de las entradas", () => {
    it("una versión publicada no cambia su descripción ni su valor", async () => {
      expect(
        await fails(
          prisma.fiscalCatalogEntry.update({
            where: { id: ivaFifteen },
            data: { officialLabel: "15 por ciento" },
          }),
        ),
      ).toContain("una versión publicada no cambia sus datos");
      expect(
        await fails(
          prisma.fiscalCatalogEntry.update({
            where: { id: ivaFifteen },
            data: { percentage: "14" },
          }),
        ),
      ).toContain("una versión publicada no cambia sus datos");
    });

    it("no se borran ni se truncan", async () => {
      expect(
        await fails(prisma.fiscalCatalogEntry.delete({ where: { id: ivaFifteen } })),
      ).toContain("no admite DELETE");
      expect(
        await fails(prisma.$executeRawUnsafe(`TRUNCATE ${table("fiscal_catalog_entry")}`)),
      ).toContain("no admite TRUNCATE");
    });

    it("no admiten versiones superpuestas de la misma entrada", async () => {
      expect(
        await fails(
          prisma.fiscalCatalogEntry.create({
            data: iva({ effectiveFrom: new Date("2026-09-01"), officialLabel: "15%" }),
          }),
        ),
      ).toContain("versiones superpuestas");
    });

    it("exigen las columnas tipadas de su catálogo (design D8)", async () => {
      expect(
        await fails(
          prisma.fiscalCatalogEntry.create({
            data: iva({ entryKey: "8", rateKind: "DIFFERENTIATED", percentage: "8.00" }),
          }),
        ),
      ).toContain("fiscal_catalog_entry_attributes_check");
      expect(
        await fails(
          prisma.fiscalCatalogEntry.create({
            data: iva({ entryKey: "8", rateKind: "PERCENTAGE", percentage: null }),
          }),
        ),
      ).toContain("fiscal_catalog_entry_attributes_check");
      expect(
        await fails(
          prisma.fiscalCatalogEntry.create({
            data: iva({
              catalogType: "ice-rate",
              entryKey: "3041-GRAN-ESCALA",
              taxKind: "ICE",
              sriTaxCode: "3",
              rateKind: "PER_NORMATIVE",
              percentage: "75.00",
              datasetVersion: 1,
            }),
          }),
        ),
      ).toContain("fiscal_catalog_entry_attributes_check");
      const differentiated = await prisma.fiscalCatalogEntry.create({
        data: iva({
          entryKey: "8",
          officialLabel: "IVA diferenciado",
          rateKind: "DIFFERENTIATED",
          percentage: null,
        }),
      });
      expect(differentiated.percentage).toBeNull();
    });

    it("una versión retirada tiene la vigencia cerrada", async () => {
      expect(
        await fails(
          prisma.fiscalCatalogEntry.create({
            data: iva({
              catalogType: "ice-rate",
              entryKey: "3041-MEDIANA-ESCALA",
              taxKind: "ICE",
              sriTaxCode: "3",
              rateKind: "PER_NORMATIVE",
              percentage: null,
              normativeStatus: "WITHDRAWN",
            }),
          }),
        ),
      ).toContain("fiscal_catalog_entry_status_check");
    });

    it("permite cerrar una vigencia abierta y retirarla, una sola vez y con su versión", async () => {
      expect(
        await fails(
          prisma.fiscalCatalogEntry.update({
            where: { id: ivaFifteen },
            data: { effectiveTo: new Date("2026-12-31") },
          }),
        ),
      ).toContain("solo se cierra una vigencia abierta");
      await prisma.fiscalCatalogDataset.create({
        data: {
          catalogType: "iva-rate",
          version: 2,
          enablementPolicy: "DEFAULT_ENABLED",
          ...SOURCE,
        },
      });
      const closed = await prisma.fiscalCatalogEntry.update({
        where: { id: ivaFifteen },
        data: {
          effectiveTo: new Date("2026-12-31"),
          closedInDatasetVersion: 2,
          normativeStatus: "WITHDRAWN",
          statusChangedInDatasetVersion: 2,
        },
      });
      expect(closed.normativeStatus).toBe("WITHDRAWN");
      expect(
        await fails(
          prisma.fiscalCatalogEntry.update({
            where: { id: ivaFifteen },
            data: { effectiveTo: new Date("2027-12-31"), closedInDatasetVersion: 3 },
          }),
        ),
      ).toContain("solo se cierra una vigencia abierta");
      expect(
        await fails(
          prisma.fiscalCatalogEntry.update({
            where: { id: ivaFifteen },
            data: { normativeStatus: "OFFICIAL", statusChangedInDatasetVersion: null },
          }),
        ),
      ).toContain("solo se retira una entrada vigente");
      // Con la vigencia cerrada, una versión nueva desde el día siguiente no se superpone.
      const next = await prisma.fiscalCatalogEntry.create({
        data: iva({ effectiveFrom: new Date("2027-01-01"), datasetVersion: 2 }),
      });
      expect(next.entryKey).toBe("4");
    });
  });

  describe("política, registro y matriz", () => {
    it("la política de consumidor final tiene la identidad canónica y no se superpone", async () => {
      const policy = {
        maxAmount: "50.00",
        currency: "USD",
        identificationType: "07",
        identification: "9999999999999",
        canonicalName: "CONSUMIDOR FINAL",
        effectiveFrom: new Date("2026-07-27"),
        effectiveFromBasis: "PROJECT_BASELINE",
        sourceRef: "Numeral 9.10, página 29",
        datasetVersion: 1,
      };
      await prisma.consumerFinalPolicy.create({ data: policy });
      expect(
        await fails(
          prisma.consumerFinalPolicy.create({
            data: { ...policy, effectiveFrom: new Date("2026-08-01") },
          }),
        ),
      ).toContain("versiones superpuestas");
      expect(
        await fails(
          prisma.consumerFinalPolicy.create({
            data: {
              ...policy,
              effectiveFrom: new Date("2020-01-01"),
              effectiveTo: new Date("2020-12-31"),
              identification: "1",
            },
          }),
        ),
      ).toContain("consumer_final_policy_values_check");
      expect(
        await fails(
          prisma.$executeRawUnsafe(`UPDATE ${table("consumer_final_policy")} SET max_amount = 60`),
        ),
      ).toContain("solo se cierra una vigencia abierta");
    });

    it("el registro y la matriz son inmutables", async () => {
      await prisma.schemaRegistryEntry.create({
        data: {
          documentType: "01",
          version: "1.1.0",
          datasetVersion: 1,
          root: "factura",
          file: "factura_V1.1.0.xsd",
          sha256: "d".repeat(64),
          source: "SRI",
          downloadedAt: new Date("2026-10-02T15:38:05Z"),
          supported: true,
        },
      });
      await prisma.specialCaseSupport.create({
        data: {
          annex: 26,
          datasetVersion: 1,
          topic: "RUC proveedor",
          category: "CONDITIONAL_GO_LIVE",
          sourceRef: "ADR 0014",
        },
      });
      expect(
        await fails(
          prisma.$executeRawUnsafe(`UPDATE ${table("special_case_support")} SET category = 'CORE'`),
        ),
      ).toContain("no admite UPDATE");
      expect(
        await fails(prisma.$executeRawUnsafe(`DELETE FROM ${table("schema_registry_entry")}`)),
      ).toContain("no admite DELETE");
      expect(
        await fails(
          prisma.specialCaseSupport.create({
            data: {
              annex: 1,
              datasetVersion: 1,
              topic: "XML 1.0.0",
              category: "SUPPORTED",
              sourceRef: "ADR 0014",
            },
          }),
        ),
      ).toContain("special_case_support_values_check");
    });
  });

  describe("habilitación por empresa", () => {
    it("solo admite catálogos habilitables y entradas existentes", async () => {
      expect(
        await fails(
          prisma.companyFiscalCatalogSetting.create({
            data: {
              companyId: companyA,
              catalogType: "identification-type",
              entryKey: "04",
              enabled: false,
              updatedBy: userA,
            },
          }),
        ),
      ).toContain("company_fiscal_catalog_setting_catalog_type_check");
      expect(
        await fails(
          prisma.companyFiscalCatalogSetting.create({
            data: {
              companyId: companyA,
              catalogType: "iva-rate",
              entryKey: "99",
              enabled: false,
              updatedBy: userA,
            },
          }),
        ),
      ).toMatch(/Foreign key constraint|foreign key/i);
      const setting = await prisma.companyFiscalCatalogSetting.create({
        data: {
          companyId: companyA,
          catalogType: "iva-rate",
          entryKey: "4",
          enabled: false,
          updatedBy: userA,
        },
      });
      expect(setting.enabled).toBe(false);
    });
  });
});

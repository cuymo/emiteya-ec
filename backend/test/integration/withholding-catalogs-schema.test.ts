// Migración add_withholding_catalogs en PostgreSQL (add-withholding-receipts, design D11 y D28): los
// catálogos de retención y de sustento con su código por catálogo, su clasificación de alcance, el
// texto del porcentaje y los sustentos admitidos solo en sus catálogos, y los catálogos existentes
// sin cambios. Escribe directamente en las tablas y después carga los datasets instalados.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { DbClient } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

const SOURCE = {
  sourceDocument: "Catálogo del Anexo Transaccional Simplificado (ATS)",
  sourceVersion: "2026-08-06",
  sourcePublishedOn: new Date("2026-08-06"),
  sourceUrl: "https://www.sri.gob.ec/formularios-e-instructivos1",
  sourceSha256: "a".repeat(64),
  checksum: "b".repeat(64),
};

describe("catálogos de retención y de sustento en la base de datos", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let companyA: string;
  let userA: string;

  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const version = (catalogType: string, entryKey: string, extra: Record<string, unknown>) =>
    prisma.fiscalCatalogEntry.create({
      data: {
        catalogType,
        entryKey,
        officialLabel: `Entrada ${entryKey}`,
        effectiveFrom: new Date("2026-08-06"),
        effectiveFromBasis: "SOURCE_STATED",
        normativeStatus: "OFFICIAL",
        sourceRef: "Prueba",
        datasetVersion: 1,
        ...extra,
      },
    });

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_catalogs_schema");
    prisma = db.database.prisma;
    companyA = await insertCompany(prisma, "Empresa A");
    userA = (await insertMember(prisma, companyA, { name: "Admin A", role: "ADMIN" })).userId;
    for (const [catalogType, enablementPolicy] of [
      ["withholding-tax", "NOT_ENABLEABLE"],
      ["withholding-iva-code", "DEFAULT_ENABLED"],
      ["withholding-income-concept", "DEFAULT_ENABLED"],
      ["support-document-type", "NOT_ENABLEABLE"],
      ["support-code", "NOT_ENABLEABLE"],
      ["iva-rate", "DEFAULT_ENABLED"],
    ] as const) {
      await prisma.fiscalCatalogDataset.create({
        data: { catalogType, version: 1, enablementPolicy, ...SOURCE },
      });
    }
    await prisma.fiscalCatalogKey.createMany({
      data: [
        { catalogType: "withholding-tax", entryKey: "1", code: "1" },
        { catalogType: "withholding-iva-code", entryKey: "7", code: "7" },
        { catalogType: "withholding-iva-code", entryKey: "3", code: "3" },
        { catalogType: "withholding-income-concept", entryKey: "312C", code: "312C" },
        { catalogType: "withholding-income-concept", entryKey: "323-M", code: "323 M" },
        { catalogType: "withholding-income-concept", entryKey: "346", code: "346" },
        { catalogType: "withholding-income-concept", entryKey: "323B1", code: "323B1" },
        { catalogType: "support-document-type", entryKey: "02", code: "02" },
        { catalogType: "support-document-type", entryKey: "373", code: "373" },
        { catalogType: "support-code", entryKey: "00", code: "00" },
        { catalogType: "iva-rate", entryKey: "4", code: "4" },
        // Claves sin versiones, para las inserciones que se rechazan.
        { catalogType: "withholding-tax", entryKey: "2", code: "2" },
        { catalogType: "withholding-iva-code", entryKey: "9", code: "9" },
        { catalogType: "support-document-type", entryKey: "374", code: "374" },
        { catalogType: "support-code", entryKey: "13", code: "13" },
        { catalogType: "iva-rate", entryKey: "8", code: "8" },
      ],
    });
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("datasets, claves y habilitación", () => {
    it("los catálogos de retención habilitables exigen una política por defecto, y los demás ninguna", async () => {
      expect(
        await fails(
          prisma.fiscalCatalogDataset.create({
            data: {
              catalogType: "withholding-income-concept",
              version: 2,
              enablementPolicy: "NOT_ENABLEABLE",
              ...SOURCE,
            },
          }),
        ),
      ).toContain("fiscal_catalog_dataset_enablement_policy_check");
      expect(
        await fails(
          prisma.fiscalCatalogDataset.create({
            data: {
              catalogType: "support-code",
              version: 2,
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
              catalogType: "withholding-isd",
              version: 1,
              enablementPolicy: "NOT_ENABLEABLE",
              ...SOURCE,
            },
          }),
        ),
      ).toContain("fiscal_catalog_dataset_catalog_type_check");
    });

    it("la renta conserva su código literal y cada catálogo rechaza los códigos fuera de su formato", async () => {
      expect(
        (
          await prisma.fiscalCatalogKey.findMany({
            where: { catalogType: "withholding-income-concept" },
          })
        )
          .map((key) => key.code)
          .sort(),
      ).toEqual(["312C", "323 M", "323B1", "346"]);
      for (const [catalogType, code] of [
        ["withholding-income-concept", "32"],
        ["withholding-income-concept", "323B12"],
        ["withholding-income-concept", "32 M"],
        ["withholding-income-concept", "323  M"],
        ["withholding-income-concept", "323m"],
        ["support-document-type", "1"],
        ["support-document-type", "1234"],
        ["support-code", "1"],
        ["support-code", "100"],
        ["withholding-iva-code", "12345"],
        ["withholding-iva-code", "7 A"],
        ["iva-rate", "323 M"],
      ] as const) {
        expect(
          await fails(
            prisma.fiscalCatalogKey.create({ data: { catalogType, entryKey: "X9", code } }),
          ),
          `${catalogType} ${code}`,
        ).toContain("fiscal_catalog_key_code_check");
      }
    });

    it("las decisiones de empresa admiten los códigos del IVA y los conceptos, pero no los sustentos", async () => {
      await prisma.companyFiscalCatalogSetting.create({
        data: {
          companyId: companyA,
          catalogType: "withholding-income-concept",
          entryKey: "312C",
          enabled: false,
          updatedBy: userA,
        },
      });
      expect(
        await fails(
          prisma.companyFiscalCatalogSetting.create({
            data: {
              companyId: companyA,
              catalogType: "support-code",
              entryKey: "00",
              enabled: false,
              updatedBy: userA,
            },
          }),
        ),
      ).toContain("company_fiscal_catalog_setting_catalog_type_check");
    });
  });

  describe("atributos por catálogo", () => {
    it("admiten cada catálogo con su clasificación y sus columnas propias", async () => {
      await version("withholding-tax", "1", { scopeClassification: "SUPPORTED" });
      await version("withholding-iva-code", "7", {
        scopeClassification: "SUPPORTED_FIXED",
        percentage: "0",
      });
      await version("withholding-iva-code", "3", {
        scopeClassification: "SUPPORTED_FIXED",
        percentage: "100",
      });
      await version("withholding-income-concept", "312C", {
        scopeClassification: "SUPPORTED_FIXED_RESIDENT",
        percentage: "1.75",
      });
      await version("withholding-income-concept", "323-M", {
        scopeClassification: "OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION",
        percentage: "3",
      });
      await version("withholding-income-concept", "346", {
        scopeClassification: "OUT_OF_SCOPE_VARIABLE",
        rateText: "varios porcentajes",
      });
      await version("support-document-type", "02", {
        scopeClassification: "SUPPORTED",
        allowedSupportCodes: ["02", "04", "05", "07", "08", "14", "15", "00"],
      });
      await version("support-document-type", "373", {
        scopeClassification: "OUT_OF_SCOPE_MVP",
        allowedSupportCodes: [],
      });
      await version("support-code", "00", {
        scopeClassification: "OUT_OF_SCOPE_EXPIRED",
        effectiveFrom: new Date("2000-01-01"),
        effectiveTo: new Date("2015-02-28"),
      });
      expect(
        await prisma.fiscalCatalogEntry.count({
          where: { catalogType: { in: ["withholding-income-concept", "support-document-type"] } },
        }),
      ).toBe(5);
    });

    it("rechazan una clasificación inválida o ajena al catálogo", async () => {
      for (const [catalogType, entryKey, extra] of [
        ["withholding-tax", "2", { scopeClassification: "SUPPORTED_FIXED" }],
        ["withholding-tax", "2", { scopeClassification: null }],
        ["withholding-iva-code", "9", { scopeClassification: "SUPPORTED", percentage: "0" }],
        [
          "withholding-income-concept",
          "323B1",
          { scopeClassification: "SUPPORTED", percentage: "3" },
        ],
        [
          "withholding-income-concept",
          "323B1",
          { scopeClassification: "OUT_OF_SCOPE_MVP", percentage: "3" },
        ],
        [
          "support-document-type",
          "374",
          { scopeClassification: "OUT_OF_SCOPE_EXPIRED", allowedSupportCodes: [] },
        ],
        ["support-code", "13", { scopeClassification: "SUPPORTED_FIXED" }],
      ] as const) {
        expect(
          await fails(
            version(catalogType, entryKey, { effectiveFrom: new Date("2030-01-01"), ...extra }),
          ),
          `${catalogType} ${JSON.stringify(extra)}`,
        ).toContain("fiscal_catalog_entry_attributes_check");
      }
    });

    it("rechazan un porcentaje con más de 3 dígitos, porcentaje y texto a la vez, o un soportado sin porcentaje", async () => {
      for (const [catalogType, entryKey, extra] of [
        [
          "withholding-iva-code",
          "9",
          { scopeClassification: "SUPPORTED_FIXED", percentage: "1000" },
        ],
        [
          "withholding-iva-code",
          "9",
          { scopeClassification: "SUPPORTED_FIXED", percentage: "10.25" },
        ],
        ["withholding-iva-code", "9", { scopeClassification: "SUPPORTED_FIXED" }],
        [
          "withholding-income-concept",
          "323B1",
          { scopeClassification: "SUPPORTED_FIXED_RESIDENT", percentage: "3", rateText: "3" },
        ],
        [
          "withholding-income-concept",
          "323B1",
          { scopeClassification: "SUPPORTED_FIXED_RESIDENT", rateText: "3 o 5" },
        ],
        [
          "withholding-income-concept",
          "323B1",
          { scopeClassification: "OUT_OF_SCOPE_VARIABLE", percentage: "3" },
        ],
        [
          "withholding-income-concept",
          "323B1",
          { scopeClassification: "OUT_OF_SCOPE_VARIABLE", rateText: "  " },
        ],
        [
          "withholding-income-concept",
          "323B1",
          { scopeClassification: "OUT_OF_SCOPE_NON_RESIDENT" },
        ],
      ] as const) {
        expect(
          await fails(
            version(catalogType, entryKey, { effectiveFrom: new Date("2030-01-01"), ...extra }),
          ),
          `${catalogType} ${JSON.stringify(extra)}`,
        ).toContain("fiscal_catalog_entry_attributes_check");
      }
    });

    it("rechazan los atributos de otro catálogo y sustentos fuera de formato", async () => {
      for (const [catalogType, entryKey, extra] of [
        [
          "withholding-income-concept",
          "323B1",
          {
            scopeClassification: "SUPPORTED_FIXED_RESIDENT",
            percentage: "3",
            allowedSupportCodes: ["01"],
          },
        ],
        [
          "withholding-income-concept",
          "323B1",
          { scopeClassification: "SUPPORTED_FIXED_RESIDENT", percentage: "3", taxKind: "IVA" },
        ],
        [
          "withholding-iva-code",
          "9",
          { scopeClassification: "SUPPORTED_FIXED", percentage: "100", rateText: "100" },
        ],
        ["withholding-tax", "2", { scopeClassification: "SUPPORTED", percentage: "1" }],
        ["support-code", "13", { scopeClassification: "SUPPORTED", allowedSupportCodes: ["01"] }],
        ["support-document-type", "374", { scopeClassification: "OUT_OF_SCOPE_MVP" }],
        [
          "support-document-type",
          "374",
          { scopeClassification: "OUT_OF_SCOPE_MVP", allowedSupportCodes: ["1"] },
        ],
        [
          "support-document-type",
          "374",
          { scopeClassification: "OUT_OF_SCOPE_MVP", allowedSupportCodes: ["01", "001"] },
        ],
        [
          "iva-rate",
          "8",
          {
            taxKind: "IVA",
            sriTaxCode: "2",
            rateKind: "PERCENTAGE",
            percentage: "15",
            scopeClassification: "SUPPORTED",
          },
        ],
        [
          "iva-rate",
          "8",
          {
            taxKind: "IVA",
            sriTaxCode: "2",
            rateKind: "PERCENTAGE",
            percentage: "15",
            rateText: "15",
          },
        ],
        [
          "iva-rate",
          "8",
          {
            taxKind: "IVA",
            sriTaxCode: "2",
            rateKind: "PERCENTAGE",
            percentage: "15",
            allowedSupportCodes: [],
          },
        ],
      ] as const) {
        expect(
          await fails(
            version(catalogType, entryKey, { effectiveFrom: new Date("2030-01-01"), ...extra }),
          ),
          `${catalogType} ${JSON.stringify(extra)}`,
        ).toContain("fiscal_catalog_entry_attributes_check");
      }
    });

    it("una versión publicada no cambia su clasificación, su texto ni sus sustentos", async () => {
      const concept = await prisma.fiscalCatalogEntry.findFirstOrThrow({
        where: { catalogType: "withholding-income-concept", entryKey: "346" },
      });
      expect(
        await fails(
          prisma.fiscalCatalogEntry.update({
            where: { id: concept.id },
            data: { rateText: "1 o 2" },
          }),
        ),
      ).toContain("una versión publicada no cambia sus datos");
      const type = await prisma.fiscalCatalogEntry.findFirstOrThrow({
        where: { catalogType: "support-document-type", entryKey: "02" },
      });
      expect(
        await fails(
          prisma.fiscalCatalogEntry.update({
            where: { id: type.id },
            data: { allowedSupportCodes: ["01", "02"], scopeClassification: "OUT_OF_SCOPE_MVP" },
          }),
        ),
      ).toContain("una versión publicada no cambia sus datos");
    });
  });
});

describe("datasets instalados sobre la migración", () => {
  let db: MigratedSchema;

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_catalogs_installed");
    await loadInstalledFiscalCatalogs(db.database.prisma);
  });

  afterAll(async () => {
    await db.drop();
  });

  it("los catálogos existentes no tienen clasificación, texto ni sustentos", async () => {
    const rows = await db.database.prisma.$queryRawUnsafe<{ catalog_type: string; n: bigint }[]>(
      `SELECT catalog_type, count(*) AS n FROM "${db.name}"."fiscal_catalog_entry"
       WHERE scope_classification IS NOT NULL OR rate_text IS NOT NULL
         OR allowed_support_codes IS NOT NULL
       GROUP BY catalog_type ORDER BY catalog_type`,
    );
    expect(rows.map((row) => [row.catalog_type, Number(row.n)])).toEqual([
      ["support-code", 16],
      ["support-document-type", 40],
      ["withholding-income-concept", 127],
      ["withholding-iva-code", 8],
      ["withholding-tax", 3],
    ]);
  });

  it("los sustentos de un tipo y el código literal de la renta llegan a la base sin transformarse", async () => {
    const prisma = db.database.prisma;
    expect(
      (
        await prisma.fiscalCatalogEntry.findFirstOrThrow({
          where: { catalogType: "support-document-type", entryKey: "02" },
        })
      ).allowedSupportCodes,
    ).toEqual(["02", "04", "05", "07", "08", "14", "15", "00"]);
    expect(
      (
        await prisma.fiscalCatalogKey.findFirstOrThrow({
          where: { catalogType: "withholding-income-concept", entryKey: "323-M" },
        })
      ).code,
    ).toBe("323 M");
    const concept = await prisma.fiscalCatalogEntry.findFirstOrThrow({
      where: { catalogType: "withholding-income-concept", entryKey: "312C" },
    });
    expect(concept.percentage?.toFixed()).toBe("1.75");
  });
});

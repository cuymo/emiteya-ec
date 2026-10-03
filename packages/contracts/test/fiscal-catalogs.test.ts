import { describe, expect, it } from "vitest";
import {
  catalogEntriesQuerySchema,
  catalogEntryParamsSchema,
  catalogEntryVersionViewSchema,
  catalogEntryViewSchema,
  consumerFinalPolicyVersionViewSchema,
  fiscalCatalogSummaryViewSchema,
  setEnablementSchema,
} from "../src/fiscal-catalogs.ts";

const version = {
  id: "v1",
  officialLabel: "15%",
  effectiveFrom: "2026-07-27",
  effectiveFromBasis: "PROJECT_BASELINE",
  effectiveTo: null,
  normativeStatus: "OFFICIAL",
  sourceRef: "Tabla 17, página 30",
  datasetVersion: 1,
  rate: { taxKind: "IVA", sriTaxCode: "2", rateKind: "PERCENTAGE", percentage: "15" },
  taxKind: null,
  identificationRule: null,
};

describe("habilitación de una entrada (design D9 y D11)", () => {
  it("acepta solo { enabled } y rechaza companyId y campos desconocidos", () => {
    expect(setEnablementSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(setEnablementSchema.safeParse({ enabled: true, companyId: "otra" }).success).toBe(false);
    expect(setEnablementSchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false);
    expect(setEnablementSchema.safeParse({ enabled: "true" }).success).toBe(false);
  });

  it("la entrada de la ruta cumple el patrón de entryKey", () => {
    expect(
      catalogEntryParamsSchema.safeParse({ catalogType: "ice-rate", entryKey: "3041-GRAN-ESCALA" })
        .success,
    ).toBe(true);
    expect(
      catalogEntryParamsSchema.safeParse({ catalogType: "ice-rate", entryKey: "3041 gran" })
        .success,
    ).toBe(false);
    expect(catalogEntryParamsSchema.safeParse({ catalogType: "otro", entryKey: "4" }).success).toBe(
      false,
    );
  });

  it("la consulta ignora un companyId y valida la fecha", () => {
    expect(catalogEntriesQuerySchema.parse({ at: "2026-10-03", companyId: "x" })).toEqual({
      at: "2026-10-03",
    });
    expect(catalogEntriesQuerySchema.safeParse({ at: "03/10/2026" }).success).toBe(false);
  });
});

describe("vistas (design D8 y D11)", () => {
  it("los porcentajes viajan como DecimalString, nunca como número", () => {
    expect(catalogEntryVersionViewSchema.safeParse(version).success).toBe(true);
    expect(
      catalogEntryVersionViewSchema.safeParse({
        ...version,
        rate: { ...version.rate, percentage: 15 },
      }).success,
    ).toBe(false);
  });

  it("el monto de la política es un importe decimal", () => {
    const policy = {
      id: "p1",
      maxAmount: "50",
      currency: "USD",
      identificationType: "07",
      identification: "9999999999999",
      canonicalName: "CONSUMIDOR FINAL",
      effectiveFrom: "2026-07-27",
      effectiveFromBasis: "PROJECT_BASELINE",
      effectiveTo: null,
      sourceRef: "Numeral 9.10, página 29",
      datasetVersion: 1,
    };
    expect(consumerFinalPolicyVersionViewSchema.safeParse(policy).success).toBe(true);
    expect(
      consumerFinalPolicyVersionViewSchema.safeParse({ ...policy, maxAmount: 50 }).success,
    ).toBe(false);
  });

  it("ninguna vista admite datos de empresa", () => {
    const entry = {
      entryKey: "4",
      code: "4",
      versions: [version],
      applicable: version,
      enablement: { enabled: true, source: "DEFAULT" },
      usable: true,
    };
    expect(catalogEntryViewSchema.safeParse(entry).success).toBe(true);
    expect(catalogEntryViewSchema.safeParse({ ...entry, companyId: "c" }).success).toBe(false);
    expect(
      fiscalCatalogSummaryViewSchema.safeParse({
        catalogType: "iva-rate",
        datasetVersion: 1,
        source: {
          document: "Ficha técnica",
          version: "2.34",
          publishedOn: "2026-07-27",
          url: "https://www.sri.gob.ec/",
          sha256: "a".repeat(64),
        },
        enablementPolicy: "DEFAULT_ENABLED",
        companyId: "c",
      }).success,
    ).toBe(false);
  });
});

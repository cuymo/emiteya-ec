// Contratos de los catálogos fiscales (add-fiscal-catalogs, design D3, D4, D8, D9 y D11). Los
// catálogos oficiales son datos del sistema; solo la habilitación es de la empresa de la sesión.
import { z } from "zod";
import { DECIMAL_SPECS, decimalString } from "./decimal.ts";

export const FISCAL_CATALOG_TYPES = [
  "identification-type",
  "tax",
  "iva-rate",
  "ice-rate",
  "irbpnr-rate",
  "payment-method",
] as const;
export const fiscalCatalogTypeSchema = z.enum(FISCAL_CATALOG_TYPES, {
  error: "El catálogo no existe.",
});
export type FiscalCatalogType = z.infer<typeof fiscalCatalogTypeSchema>;

/** Origen de la fecha de inicio: declarada por la fuente o base del proyecto (design D3). */
export const EFFECTIVE_FROM_BASES = ["SOURCE_STATED", "PROJECT_BASELINE"] as const;
export const effectiveFromBasisSchema = z.enum(EFFECTIVE_FROM_BASES);
export type EffectiveFromBasis = z.infer<typeof effectiveFromBasisSchema>;

export const NORMATIVE_STATUSES = ["OFFICIAL", "OFFICIAL_REFERENCE", "WITHDRAWN"] as const;
export const normativeStatusSchema = z.enum(NORMATIVE_STATUSES);
export type NormativeStatus = z.infer<typeof normativeStatusSchema>;

/** Política de habilitación por empresa de cada catálogo, declarada en su dataset (design D9). */
export const ENABLEMENT_POLICIES = [
  "NOT_ENABLEABLE",
  "DEFAULT_ENABLED",
  "DEFAULT_DISABLED",
] as const;
export const enablementPolicySchema = z.enum(ENABLEMENT_POLICIES);
export type EnablementPolicy = z.infer<typeof enablementPolicySchema>;

export const ENABLEMENT_SOURCES = ["DEFAULT", "COMPANY", "NOT_ENABLEABLE"] as const;
export const enablementSourceSchema = z.enum(ENABLEMENT_SOURCES);

export const TAX_KINDS = ["IVA", "ICE", "IRBPNR"] as const;
export const taxKindSchema = z.enum(TAX_KINDS);
export type TaxKind = z.infer<typeof taxKindSchema>;

/** Semántica de cada tarifa (design D8): nunca un único porcentaje para todos los impuestos. */
export const RATE_KINDS = [
  "PERCENTAGE",
  "NOT_SUBJECT",
  "EXEMPT",
  "DIFFERENTIATED",
  "PER_NORMATIVE",
  "PER_UNIT",
] as const;
export const rateKindSchema = z.enum(RATE_KINDS);
export type RateKind = z.infer<typeof rateKindSchema>;

const isoDate = z.iso.date();

export const catalogSourceViewSchema = z.strictObject({
  document: z.string(),
  version: z.string(),
  publishedOn: isoDate,
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CatalogSourceView = z.infer<typeof catalogSourceViewSchema>;

export const fiscalCatalogSummaryViewSchema = z.strictObject({
  catalogType: fiscalCatalogTypeSchema,
  datasetVersion: z.number().int().positive(),
  source: catalogSourceViewSchema,
  enablementPolicy: enablementPolicySchema,
});
export type FiscalCatalogSummaryView = z.infer<typeof fiscalCatalogSummaryViewSchema>;

/** Semántica de una tarifa de IVA, ICE o IRBPNR; la reutilizan las vistas de productos. */
export const catalogRateViewSchema = z.strictObject({
  taxKind: taxKindSchema,
  sriTaxCode: z.string(),
  rateKind: rateKindSchema,
  percentage: decimalString(DECIMAL_SPECS.tarifa).nullable(),
});
export type CatalogRateView = z.infer<typeof catalogRateViewSchema>;

export const catalogEntryVersionViewSchema = z.strictObject({
  /** Identificador estable de la versión: lo guardará un comprobante para reproducirla. */
  id: z.string(),
  officialLabel: z.string(),
  effectiveFrom: isoDate,
  effectiveFromBasis: effectiveFromBasisSchema,
  effectiveTo: isoDate.nullable(),
  normativeStatus: normativeStatusSchema,
  sourceRef: z.string(),
  datasetVersion: z.number().int().positive(),
  /** Tarifas de IVA, ICE e IRBPNR. `percentage` solo existe con `PERCENTAGE`. */
  rate: catalogRateViewSchema.nullable(),
  /** Impuestos: a qué impuesto corresponde el código. */
  taxKind: taxKindSchema.nullable(),
  /** Tipos de identificación: regla de formato y si el tipo está reservado. */
  identificationRule: z
    .strictObject({
      pattern: z.string().nullable(),
      description: z.string(),
      reservedFor: z.literal("CONSUMER_FINAL").nullable(),
    })
    .nullable(),
});
export type CatalogEntryVersionView = z.infer<typeof catalogEntryVersionViewSchema>;

export const catalogEntryViewSchema = z.strictObject({
  entryKey: z.string(),
  code: z.string(),
  versions: z.array(catalogEntryVersionViewSchema),
  /** Versión aplicable en la fecha consultada, o null si ninguna aplica. */
  applicable: catalogEntryVersionViewSchema.nullable(),
  enablement: z.strictObject({ enabled: z.boolean(), source: enablementSourceSchema }),
  /** Habilitada y con versión aplicable en la fecha consultada. */
  usable: z.boolean(),
});
export type CatalogEntryView = z.infer<typeof catalogEntryViewSchema>;

export const catalogEntriesViewSchema = z.strictObject({
  catalog: fiscalCatalogSummaryViewSchema,
  at: isoDate,
  entries: z.array(catalogEntryViewSchema),
});
export type CatalogEntriesView = z.infer<typeof catalogEntriesViewSchema>;

/** Consulta no estricta: un `companyId` en la query se ignora, como en los demás listados. */
export const catalogEntriesQuerySchema = z.object({
  at: isoDate.optional(),
  enabled: z.enum(["true", "false"]).optional(),
});

/** Identidad de una entrada dentro de su catálogo (design D6 de add-fiscal-catalogs). */
export const ENTRY_KEY_PATTERN = /^[0-9A-Z][0-9A-Z-]{0,63}$/;

export const catalogTypeParamsSchema = z.strictObject({ catalogType: fiscalCatalogTypeSchema });
export const catalogEntryParamsSchema = z.strictObject({
  catalogType: fiscalCatalogTypeSchema,
  entryKey: z.string().regex(ENTRY_KEY_PATTERN, "La entrada no existe."),
});

export const setEnablementSchema = z.strictObject(
  { enabled: z.boolean({ error: "Indica si la entrada queda habilitada." }) },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? "La solicitud contiene campos no permitidos."
        : "La solicitud no es válida.",
  },
);
export type SetEnablementInput = z.infer<typeof setEnablementSchema>;

export const consumerFinalPolicyVersionViewSchema = z.strictObject({
  id: z.string(),
  maxAmount: decimalString(DECIMAL_SPECS.importe),
  currency: z.literal("USD"),
  identificationType: z.string(),
  identification: z.string(),
  canonicalName: z.string(),
  effectiveFrom: isoDate,
  effectiveFromBasis: effectiveFromBasisSchema,
  effectiveTo: isoDate.nullable(),
  sourceRef: z.string(),
  datasetVersion: z.number().int().positive(),
});
export const consumerFinalPolicyViewSchema = z.strictObject({
  source: catalogSourceViewSchema,
  at: isoDate,
  applicable: consumerFinalPolicyVersionViewSchema.nullable(),
  versions: z.array(consumerFinalPolicyVersionViewSchema),
});
export type ConsumerFinalPolicyView = z.infer<typeof consumerFinalPolicyViewSchema>;

/** Archivo del registro de esquemas: un XSD de comprobante o un esquema que este importa. */
export const schemaRegistryEntryViewSchema = z.strictObject({
  kind: z.enum(["DOCUMENT", "IMPORT"]),
  path: z.string(),
  documentType: z.string().nullable(),
  root: z.string().nullable(),
  version: z.string().nullable(),
  file: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  source: z.string(),
  revision: z.string().nullable(),
  imports: z.array(z.string()),
  downloadedAt: z.iso.datetime(),
  supported: z.boolean(),
});
export type SchemaRegistryEntryView = z.infer<typeof schemaRegistryEntryViewSchema>;

/** Categorías del ADR 0014 (Q-38). */
export const SPECIAL_CASE_CATEGORIES = [
  "CORE",
  "CONDITIONAL_ISSUER_RULE",
  "CONDITIONAL_GO_LIVE",
  "NOT_APPLICABLE",
  "OUT_OF_MVP",
] as const;
export const specialCaseCategorySchema = z.enum(SPECIAL_CASE_CATEGORIES);
export type SpecialCaseCategory = z.infer<typeof specialCaseCategorySchema>;

export const specialCaseViewSchema = z.strictObject({
  annex: z.number().int().min(1),
  topic: z.string(),
  category: specialCaseCategorySchema,
  sourceRef: z.string(),
});
export type SpecialCaseView = z.infer<typeof specialCaseViewSchema>;

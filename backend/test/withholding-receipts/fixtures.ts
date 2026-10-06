// Datos de prueba del dominio de las retenciones (add-withholding-receipts): catálogos construidos
// desde los datasets instalados, resueltos en una fecha como lo haría `catalogs`, y borradores
// completos que cada prueba modifica.
import type { ScopeClassification } from "@facturador/contracts";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import {
  supportTaxRateQueries,
  type CatalogOption,
  type CatalogVersion,
  type WithheldSubject,
  type WithholdingCatalogs,
  type WithholdingEvaluationInput,
} from "../../src/modules/withholding-receipts/domain/evaluation.ts";
import type {
  DraftSupport,
  WithholdingDraftContent,
} from "../../src/modules/withholding-receipts/domain/draft.ts";

type DatasetEntry = {
  entryKey: string;
  code: string;
  officialLabel: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceRef: string;
  percentage?: string | null;
  rateKind?: string;
  scopeClassification?: ScopeClassification;
  allowedSupportCodes?: string[];
};
const datasets = DATASET_FILES as {
  catalogType: string;
  enablementPolicy: string;
  entries?: DatasetEntry[];
}[];
const entriesOf = (catalogType: string) =>
  datasets.find((dataset) => dataset.catalogType === catalogType)!.entries!;

const RATED = new Set(["iva-rate", "ice-rate", "irbpnr-rate"]);
export const version = (catalogType: string, entry: DatasetEntry): CatalogVersion => ({
  catalogType,
  entryKey: entry.entryKey,
  code: entry.code,
  officialLabel: entry.officialLabel,
  versionId: `${catalogType}:${entry.entryKey}@${entry.effectiveFrom}`,
  datasetVersion: 1,
  percentage: entry.percentage ?? null,
  rateKind:
    catalogType === "iva-rate" ? entry.rateKind! : RATED.has(catalogType) ? "PER_NORMATIVE" : null,
  scopeClassification: entry.scopeClassification ?? null,
  allowedSupportCodes: entry.allowedSupportCodes ?? null,
  sourceRef: entry.sourceRef,
});

const applies = (entry: DatasetEntry, date: string) =>
  entry.effectiveFrom <= date && (entry.effectiveTo === null || entry.effectiveTo >= date);

/** Disponibilidad de un catálogo en una fecha, con las entradas que la empresa deshabilitó. */
export function options(
  catalogType: string,
  date: string,
  disabled: ReadonlySet<string> = new Set(),
): Map<string, CatalogOption> {
  const result = new Map<string, CatalogOption>();
  for (const entry of entriesOf(catalogType)) {
    const applicable = applies(entry, date) ? version(catalogType, entry) : null;
    const classification = entry.scopeClassification ?? null;
    const enabled = !disabled.has(entry.entryKey);
    result.set(entry.entryKey, {
      entryKey: entry.entryKey,
      applicable,
      scopeClassification: classification,
      enabled,
      usable:
        applicable !== null &&
        enabled &&
        (classification === null || classification.startsWith("SUPPORTED")),
    });
  }
  return result;
}

/** Código de porcentaje de un impuesto del documento en la fecha del documento, o null. */
export function rateAt(catalogType: string, entryKey: string, date: string): CatalogVersion | null {
  const entry = entriesOf(catalogType).find((e) => e.entryKey === entryKey && applies(e, date));
  return entry ? version(catalogType, entry) : null;
}

export const ISSUE_DATE = "2026-10-06";

export function catalogsFor(
  supports: readonly DraftSupport[],
  date = ISSUE_DATE,
  disabled: Partial<Record<string, ReadonlySet<string>>> = {},
): WithholdingCatalogs {
  const taxes = new Map(
    entriesOf("tax")
      .filter((entry) => applies(entry, date))
      .map((entry) => [entry.code, version("tax", entry)]),
  );
  return {
    withholdingTaxes: options("withholding-tax", date),
    incomeConcepts: options(
      "withholding-income-concept",
      date,
      disabled["withholding-income-concept"],
    ),
    ivaCodes: options("withholding-iva-code", date, disabled["withholding-iva-code"]),
    documentTypes: options("support-document-type", date),
    supportCodes: options("support-code", date),
    paymentMethods: options("payment-method", date, disabled["payment-method"]),
    supportTaxes: taxes,
    supportTaxRates: new Map(
      supportTaxRateQueries(supports).map((query) => [
        query.key,
        rateAt(query.catalogType, query.entryKey, query.date),
      ]),
    ),
  };
}

export const SUPPLIER: WithheldSubject = {
  id: "party-1",
  status: "ACTIVE",
  identificationType: "04",
  identification: "1791234567001",
  legalName: "PROVEEDORA DEL SUR S.A.",
  roles: ["SUPPLIER"],
  consumerFinal: false,
};

export const SUPPORT: DraftSupport = {
  documentType: "01",
  supportCode: "01",
  number: "001001000000123",
  issueDate: "2026-10-01",
  authorizationNumber: "1".repeat(49),
  totalWithoutTaxes: "100.29",
  importTotal: "115.33",
  taxes: [{ tax: "2", rateEntryKey: "4", rate: null, base: "100.29", amount: "15.04" }],
  payments: [{ paymentMethod: "20", total: "115.33" }],
  withholdings: [
    { tax: "1", entryKey: "312C", base: "100.29" },
    { tax: "2", entryKey: "1", base: "15.04" },
  ],
};

export const DRAFT: Omit<WithholdingDraftContent, "emissionPointId"> = {
  partyId: "party-1",
  relatedParty: "NO",
  fiscalPeriod: "10/2026",
  supports: [SUPPORT],
};

export const LIMITS = {
  supports: 10,
  itemsPerSupport: 5,
  taxesPerSupport: 5,
  paymentsPerSupport: 5,
};

/** Entrada completa de la evaluación, con los catálogos resueltos para sus documentos. */
export function evaluationInput(
  overrides: Omit<Partial<WithholdingEvaluationInput>, "draft"> & {
    draft?: Partial<WithholdingEvaluationInput["draft"]>;
    disabled?: Partial<Record<string, ReadonlySet<string>>>;
  } = {},
): WithholdingEvaluationInput {
  const draft = { ...DRAFT, ...overrides.draft };
  const issueDate = overrides.issueDate ?? ISSUE_DATE;
  return {
    issueDate,
    draft,
    subject: overrides.subject === undefined ? SUPPLIER : overrides.subject,
    catalogs: overrides.catalogs ?? catalogsFor(draft.supports, issueDate, overrides.disabled),
    limits: overrides.limits ?? LIMITS,
    specialTaxpayerNumber: overrides.specialTaxpayerNumber ?? null,
    readiness: overrides.readiness ?? [],
  };
}

export const withSupport = (support: Partial<DraftSupport>, index = 0) => {
  const supports = [...DRAFT.supports];
  supports[index] = { ...SUPPORT, ...support };
  return { supports };
};

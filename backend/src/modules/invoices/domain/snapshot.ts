// Snapshot de la factura (add-invoice-emission, design D4): un JSON versionado con todo lo que el
// XML necesita y las versiones aplicadas (CTX §39). Se construye en la transacción de reserva desde
// la evaluación y, desde ese momento, es inmutable y la única fuente de verdad: nada reconstruye la
// factura desde terceros, productos, catálogos ni la configuración.
import { compareDecimalStrings } from "@facturador/contracts";
import type { InvoiceTotals } from "./amounts.ts";
import {
  CONSUMER_FINAL,
  type Evaluation,
  type EvaluationInput,
  type SpecialCaseRule,
} from "./evaluation.ts";

export const SNAPSHOT_VERSION = 1;

const ENVIRONMENT_CODES = { TEST: "1", PRODUCTION: "2" } as const;

export type SnapshotTax = Readonly<{
  taxCode: string;
  rateCode: string;
  catalogType: string;
  entryKey: string;
  versionId: string;
  officialLabel: string;
  percentage: string;
  base: string;
  amount: string;
}>;

export type SnapshotLine = Readonly<{
  position: number;
  /** Informativo: la factura no vuelve a leer el producto. */
  productId: string;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  subtotal: string;
  taxableBase: string;
  taxes: readonly SnapshotTax[];
}>;

export type InvoiceSnapshotV1 = Readonly<{
  snapshotVersion: typeof SNAPSHOT_VERSION;
  schema: Readonly<{
    documentType: "01";
    version: string;
    path: string;
    sha256: string;
    imports: readonly Readonly<{ path: string; sha256: string }>[];
  }>;
  builderVersion: string;
  /** Última versión aplicada de cada catálogo usado. */
  catalogDatasets: Readonly<Record<string, number>>;
  taxpayerConfig: Readonly<{ versionId: string; version: number }>;
  issueDate: string;
  environment: "TEST" | "PRODUCTION";
  environmentCode: "1" | "2";
  issuer: Readonly<{
    ruc: string;
    legalName: string;
    tradeName: string | null;
    headOfficeAddress: string;
    establishment: Readonly<{ id: string; code: string; address: string }>;
    emissionPoint: Readonly<{ id: string; code: string }>;
    accountingRequired: boolean;
    specialTaxpayerNumber: string | null;
    withholdingAgentResolution: string | null;
    rimpeCategory: "EMPRENDEDOR" | "NEGOCIO_POPULAR" | null;
    largeTaxpayer: boolean;
  }>;
  buyer: Readonly<{
    /** Informativo: la factura no vuelve a leer el tercero. */
    partyId: string;
    identificationType: string;
    identification: string;
    legalName: string;
    address: string | null;
    consumerFinal: boolean;
    consumerFinalPolicy: Readonly<{
      versionId: string;
      maxAmount: string;
      allowed: boolean;
    }> | null;
  }>;
  lines: readonly SnapshotLine[];
  totals: Readonly<{
    withoutTaxes: string;
    discount: string;
    taxes: readonly Readonly<{
      taxCode: string;
      rateCode: string;
      percentage: string;
      base: string;
      amount: string;
    }>[];
    total: string;
  }>;
  payments: readonly Readonly<{
    position: number;
    entryKey: string;
    code: string;
    versionId: string;
    officialLabel: string;
    amount: string;
  }>[];
  specialCases: Readonly<{
    /** Atributos de la operación que activan un anexo: ninguno en la factura de este cambio. */
    operation: readonly number[];
    issuerRules: readonly SpecialCaseRule[];
  }>;
  key: Readonly<{
    documentNumber: string;
    /** Nueve dígitos. */
    sequential: string;
    numericCode: string;
    emissionType: "1";
    accessKey: string;
  }>;
}>;

/** Snapshot completo salvo los datos de la reserva, que se añaden con `withKey`. */
export type SnapshotDraft = Omit<InvoiceSnapshotV1, "key">;

export class SnapshotIncompleteError extends Error {
  constructor() {
    super("La evaluación tiene problemas: no se construye el snapshot.");
    this.name = "SnapshotIncompleteError";
  }
}

/** Catálogos de los que depende la factura, con su última versión aplicada. */
function usedCatalogs(
  input: EvaluationInput,
  lines: readonly SnapshotLine[],
  datasetVersions: Readonly<Record<string, number>>,
): Record<string, number> {
  const used = new Set([
    "identification-type",
    "payment-method",
    "special-case-matrix",
    "schema-registry",
    ...lines.flatMap((line) => line.taxes.map((tax) => tax.catalogType)),
  ]);
  if (input.buyer?.systemRecord === CONSUMER_FINAL) used.add("consumer-final-policy");
  return Object.fromEntries(
    [...used]
      .sort()
      .filter((type) => datasetVersions[type] !== undefined)
      .map((type) => [type, datasetVersions[type]!]),
  );
}

/**
 * Snapshot desde una evaluación sin problemas, el esquema registrado y las versiones aplicadas.
 * Lanza `SnapshotIncompleteError` si la evaluación no permite emitir.
 */
export function buildSnapshot(args: {
  input: EvaluationInput;
  evaluation: Evaluation;
  schema: InvoiceSnapshotV1["schema"];
  builderVersion: string;
  datasetVersions: Readonly<Record<string, number>>;
}): SnapshotDraft {
  const { input, evaluation } = args;
  const { config, point, buyer } = input;
  const totals: InvoiceTotals | null = evaluation.totals;
  const payments = evaluation.payments;
  if (evaluation.issues.length > 0 || !config || !point || !buyer || !totals || !payments) {
    throw new SnapshotIncompleteError();
  }
  const lines: SnapshotLine[] = evaluation.lines.map((line) => ({
    position: line.position,
    productId: line.productId,
    mainCode: line.mainCode,
    auxiliaryCode: line.auxiliaryCode,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount: line.discount,
    subtotal: line.subtotal,
    taxableBase: line.taxableBase,
    taxes: line.taxes.map((tax) => ({
      taxCode: tax.taxCode,
      rateCode: tax.rateCode,
      catalogType: tax.catalogType,
      entryKey: tax.entryKey,
      versionId: tax.versionId,
      officialLabel: tax.officialLabel,
      percentage: tax.percentage,
      base: tax.base,
      amount: tax.amount,
    })),
  }));
  const consumerFinal = buyer.systemRecord === CONSUMER_FINAL;
  const policy = input.consumerFinalPolicy;
  const { profile } = config;
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    schema: args.schema,
    builderVersion: args.builderVersion,
    catalogDatasets: usedCatalogs(input, lines, args.datasetVersions),
    taxpayerConfig: { versionId: config.versionId, version: config.version },
    issueDate: input.issueDate,
    environment: config.environment,
    environmentCode: ENVIRONMENT_CODES[config.environment],
    issuer: {
      ruc: profile.ruc,
      legalName: profile.legalName,
      tradeName: profile.tradeName,
      headOfficeAddress: profile.headOfficeAddress,
      establishment: {
        id: point.establishment.id,
        code: point.establishment.code,
        address: point.establishment.address,
      },
      emissionPoint: { id: point.point.id, code: point.point.code },
      accountingRequired: profile.accountingRequired,
      specialTaxpayerNumber: profile.specialTaxpayerNumber,
      withholdingAgentResolution: profile.withholdingAgentResolution,
      rimpeCategory: profile.rimpeCategory,
      largeTaxpayer: profile.largeTaxpayer,
    },
    buyer: {
      partyId: buyer.id,
      identificationType: buyer.identificationType,
      identification: buyer.identification,
      legalName: buyer.legalName,
      address: buyer.address,
      consumerFinal,
      consumerFinalPolicy:
        consumerFinal && policy
          ? {
              versionId: policy.id,
              maxAmount: policy.maxAmount,
              allowed: compareDecimalStrings(totals.total, policy.maxAmount) <= 0,
            }
          : null,
    },
    lines,
    totals: {
      withoutTaxes: totals.withoutTaxes,
      discount: totals.discount,
      taxes: totals.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
        taxCode,
        rateCode,
        percentage,
        base,
        amount,
      })),
      total: totals.total,
    },
    payments: payments.map(({ position, entryKey, code, versionId, officialLabel, amount }) => ({
      position,
      entryKey,
      code,
      versionId,
      officialLabel,
      amount,
    })),
    specialCases: { operation: [], issuerRules: evaluation.specialCases },
  };
}

/** Completa el snapshot con el número reservado, el código numérico y la clave de acceso. */
export const withKey = (
  draft: SnapshotDraft,
  key: InvoiceSnapshotV1["key"],
): InvoiceSnapshotV1 => ({ ...draft, key });

// Construcción del snapshot de la liquidación de compra en la transacción de reserva
// (add-purchase-settlements, design D3 y D11): desde la evaluación sin problemas (proveedor, líneas,
// IVA y pagos resueltos con la fecha de la reserva), el resultado del cálculo único, las cuatro
// declaraciones confirmadas por quien emite y los datos del emisor vigentes al reservar. Desde ese
// momento la liquidación no vuelve a leer el tercero, los productos, los catálogos ni la
// configuración para construir su XML o su RIDE.
import {
  PURCHASE_SETTLEMENT_CURRENCY,
  PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY,
  PURCHASE_SETTLEMENT_STATEMENTS,
} from "@facturador/contracts";
import type { PurchaseSettlementAmounts } from "./amounts.ts";
import type {
  CatalogVersion,
  PurchaseSupplier,
  ResolvedLine,
  ResolvedPayment,
} from "./evaluation.ts";
import {
  PURCHASE_SETTLEMENT_SNAPSHOT_VERSION,
  type PurchaseCatalogRef,
  type PurchaseSettlementSnapshotDraft,
} from "./snapshot.ts";

const ENVIRONMENT_CODES = { TEST: "1", PRODUCTION: "2" } as const;

export type IssuerConfig = Readonly<{
  versionId: string;
  version: number;
  environment: "TEST" | "PRODUCTION";
  profile: Readonly<{
    ruc: string;
    legalName: string;
    tradeName: string | null;
    headOfficeAddress: string;
    accountingRequired: boolean;
    specialTaxpayerNumber: string | null;
    withholdingAgentResolution: string | null;
    rimpeCategory: "EMPRENDEDOR" | "NEGOCIO_POPULAR" | null;
    /** Condiciones del emisor que la regla de casos especiales bloquea (anexos 24 y 26). */
    largeTaxpayer: boolean;
    providerRuc: string | null;
  }>;
}>;

export type IssuerPoint = Readonly<{
  point: Readonly<{ id: string; code: string }>;
  establishment: Readonly<{ id: string; code: string; address: string }>;
}>;

const ref = (version: CatalogVersion): PurchaseCatalogRef => ({
  catalogType: version.catalogType,
  entryKey: version.entryKey,
  versionId: version.versionId,
  datasetVersion: version.datasetVersion,
});

/** Catálogos de los que depende la liquidación, con la versión aplicada de su dataset. */
function usedCatalogs(
  lines: readonly ResolvedLine[],
  payments: readonly ResolvedPayment[],
  datasetVersions: Readonly<Record<string, number>>,
): Record<string, number> {
  const used = new Set(["schema-registry"]);
  for (const line of lines) used.add(line.iva.entry.catalogType);
  for (const payment of payments) used.add(payment.entry.catalogType);
  return Object.fromEntries(
    [...used]
      .sort()
      .filter((type) => datasetVersions[type] !== undefined)
      .map((type) => [type, datasetVersions[type]!]),
  );
}

export function buildPurchaseSettlementSnapshot(args: {
  supplier: PurchaseSupplier;
  address: string;
  lines: readonly ResolvedLine[];
  payments: readonly ResolvedPayment[];
  amounts: PurchaseSettlementAmounts;
  /** Quien confirma las cuatro declaraciones al emitir, y el momento de la reserva. */
  declared: Readonly<{ by: string; byName: string | null; at: Date }>;
  config: IssuerConfig;
  point: IssuerPoint;
  schema: PurchaseSettlementSnapshotDraft["schema"];
  builderVersion: string;
  datasetVersions: Readonly<Record<string, number>>;
  issueDate: string;
}): PurchaseSettlementSnapshotDraft {
  const { lines, payments, amounts, config, point } = args;
  const calculated = new Map(amounts.lines.map((line) => [line.position, line]));
  if (
    lines.length === 0 ||
    payments.length === 0 ||
    lines.length !== amounts.lines.length ||
    lines.some((line) => !calculated.has(line.position))
  ) {
    throw new Error("Las líneas no son las del cálculo: no se construye el snapshot.");
  }
  const { profile } = config;
  const declaredAt = args.declared.at.toISOString();
  return {
    snapshotVersion: PURCHASE_SETTLEMENT_SNAPSHOT_VERSION,
    schema: args.schema,
    builderVersion: args.builderVersion,
    calculationVersion: amounts.calculationVersion,
    catalogDatasets: usedCatalogs(lines, payments, args.datasetVersions),
    taxpayerConfig: { versionId: config.versionId, version: config.version },
    issueDate: args.issueDate,
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
    },
    supplier: {
      partyId: args.supplier.id,
      identificationType: args.supplier.identificationType,
      identification: args.supplier.identification,
      legalName: args.supplier.legalName,
      address: args.address,
    },
    eligibility: {
      case: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.case,
      policy: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.id,
      rule: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.rule,
      policyVersion: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.version,
      declarations: PURCHASE_SETTLEMENT_STATEMENTS.map((statementId) => ({
        statementId,
        policyVersion: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.version,
        basis: "USER_DECLARED" as const,
        declaredBy: args.declared.by,
        declaredByName: args.declared.byName,
        declaredAt,
      })),
    },
    lines: lines.map((line) => {
      const amount = calculated.get(line.position)!;
      return {
        position: line.position,
        productId: line.productId,
        mainCode: line.mainCode,
        auxiliaryCode: line.auxiliaryCode,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: amount.discount,
        taxableBase: amount.taxableBase,
        tax: {
          taxCode: "2" as const,
          rateCode: line.iva.entry.code,
          rateKind: line.iva.rateKind,
          percentage: line.iva.percentage,
          label: line.iva.entry.officialLabel,
          ref: ref(line.iva.entry),
          base: amount.tax.base,
          amount: amount.tax.amount,
        },
      };
    }),
    totals: {
      withoutTaxes: amounts.totals.withoutTaxes,
      discount: amounts.totals.discount,
      taxes: amounts.totals.taxes.map((tax) => ({
        taxCode: "2" as const,
        rateCode: tax.rateCode,
        percentage: tax.percentage,
        base: tax.base,
        amount: tax.amount,
      })),
      total: amounts.totals.total,
    },
    payments: payments.map((payment) => ({
      position: payment.position,
      code: payment.entry.code,
      officialLabel: payment.entry.officialLabel,
      ref: ref(payment.entry),
      total: payment.total,
      term: payment.term,
      timeUnit: payment.timeUnit,
    })),
    currency: PURCHASE_SETTLEMENT_CURRENCY,
    counts: { lines: lines.length, payments: payments.length },
  };
}

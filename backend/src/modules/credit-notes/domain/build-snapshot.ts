// Construcción del snapshot de la nota en la transacción de reserva (add-credit-notes, design D24):
// desde la factura leída de su snapshot, el resultado del cálculo único y los datos del emisor
// vigentes al reservar. Desde ese momento la nota no vuelve a leer la factura para un importe.
import type { CreditNoteCause } from "@facturador/contracts";
import type { CreditNoteAmounts } from "./amounts.ts";
import type { CreditInvoiceLine, ResolvedLine } from "./evaluation.ts";
import {
  CREDIT_NOTE_SNAPSHOT_VERSION,
  type CreditNoteSnapshotDraft,
  type CreditNoteSnapshotTax,
} from "./snapshot.ts";

const ENVIRONMENT_CODES = { TEST: "1", PRODUCTION: "2" } as const;

/** Impuesto de una línea de la factura con su catálogo, tal como lo guarda su snapshot. */
export type SourceTax = CreditNoteSnapshotTax;

/** Línea de la factura con los impuestos de su catálogo. */
export type SourceLine = Omit<CreditInvoiceLine, "taxes"> &
  Readonly<{ taxes: readonly SourceTax[] }>;

export type SourceInvoice = Readonly<{
  id: string;
  documentNumber: string;
  issueDate: string;
  accessKey: string;
  environment: "TEST" | "PRODUCTION";
  authorization: Readonly<{ number: string; date: Date }>;
  snapshotVersion: number;
  buyer: Readonly<{
    identificationType: string;
    identification: string;
    legalName: string;
    address: string | null;
  }>;
  lines: readonly SourceLine[];
}>;

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

/** Catálogos de los que depende la nota: el registro de esquemas y las tarifas que acredita. */
function usedCatalogs(
  lines: CreditNoteSnapshotDraft["lines"],
  datasetVersions: Readonly<Record<string, number>>,
): Record<string, number> {
  const used = new Set([
    "schema-registry",
    ...lines.flatMap((l) => l.taxes.map((t) => t.catalogType)),
  ]);
  return Object.fromEntries(
    [...used]
      .sort()
      .filter((type) => datasetVersions[type] !== undefined)
      .map((type) => [type, datasetVersions[type]!]),
  );
}

export function buildCreditNoteSnapshot(args: {
  invoice: SourceInvoice;
  config: IssuerConfig;
  point: IssuerPoint;
  schema: CreditNoteSnapshotDraft["schema"];
  builderVersion: string;
  datasetVersions: Readonly<Record<string, number>>;
  issueDate: string;
  cause: CreditNoteCause;
  reason: string;
  lines: readonly ResolvedLine[];
  amounts: CreditNoteAmounts;
  declarations: CreditNoteSnapshotDraft["declarations"];
}): CreditNoteSnapshotDraft {
  const { invoice, config, point, amounts } = args;
  if (!amounts.totals || amounts.issues.length > 0) {
    throw new Error("El cálculo tiene problemas: no se construye el snapshot.");
  }
  const originals = new Map(invoice.lines.map((line) => [line.position, line]));
  const returns = new Map(args.lines.map((line) => [line.position, line.physicalReturn]));
  const lines = amounts.lines.map((line, index) => {
    const original = originals.get(line.position);
    if (!original) throw new Error(`La línea ${line.position} no es de la factura.`);
    const catalog = new Map(original.taxes.map((tax) => [`${tax.taxCode}:${tax.rateCode}`, tax]));
    return {
      position: index + 1,
      invoicePosition: line.position,
      productId: original.productId,
      mainCode: original.mainCode,
      auxiliaryCode: original.auxiliaryCode,
      description: original.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      subtotal: line.subtotal,
      discount: line.discount,
      taxableBase: line.taxableBase,
      taxes: line.taxes.map((tax) => {
        const source = catalog.get(`${tax.taxCode}:${tax.rateCode}`);
        if (!source) throw new Error(`La tarifa ${tax.taxCode}:${tax.rateCode} no es de la línea.`);
        return {
          taxCode: tax.taxCode,
          rateCode: tax.rateCode,
          catalogType: source.catalogType,
          entryKey: source.entryKey,
          versionId: source.versionId,
          officialLabel: source.officialLabel,
          percentage: tax.percentage,
          base: tax.base,
          amount: tax.amount,
        };
      }),
      physicalReturn: returns.get(line.position) ?? "0",
      inventoryAffectsStock: original.inventoryAffectsStock,
    };
  });
  const { profile } = config;
  return {
    snapshotVersion: CREDIT_NOTE_SNAPSHOT_VERSION,
    schema: args.schema,
    builderVersion: args.builderVersion,
    calculationVersion: amounts.calculationVersion,
    catalogDatasets: usedCatalogs(lines, args.datasetVersions),
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
    buyer: { ...invoice.buyer },
    cause: args.cause,
    reason: args.reason,
    invoice: {
      id: invoice.id,
      documentType: "01",
      documentNumber: invoice.documentNumber,
      issueDate: invoice.issueDate,
      accessKey: invoice.accessKey,
      authorizationNumber: invoice.authorization.number,
      authorizationDate: invoice.authorization.date.toISOString(),
      environment: invoice.environment,
      snapshotVersion: invoice.snapshotVersion,
    },
    lines,
    totals: {
      withoutTaxes: amounts.totals.withoutTaxes,
      discount: amounts.totals.discount,
      taxes: amounts.totals.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
        taxCode,
        rateCode,
        percentage,
        base,
        amount,
      })),
      total: amounts.totals.total,
    },
    declarations: args.declarations,
  };
}

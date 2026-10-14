// Construcción del snapshot de la nota en la transacción de reserva (add-debit-notes, design D13):
// desde la factura leída de su snapshot, el resultado del cálculo único, la forma de pago resuelta y
// los datos del emisor vigentes al reservar. Desde ese momento la nota no vuelve a leer la factura,
// el catálogo ni la configuración para construir su XML o su RIDE.
import type { DebitNoteAmounts } from "./amounts.ts";
import type { DebitNotePayment, ResolvedConcept } from "./evaluation.ts";
import {
  DEBIT_NOTE_SNAPSHOT_VERSION,
  type DebitNoteSnapshot,
  type DebitNoteSnapshotDraft,
} from "./snapshot.ts";
import type { InvoiceTaxTreatment } from "./treatments.ts";

const ENVIRONMENT_CODES = { TEST: "1", PRODUCTION: "2" } as const;

/** La factura modificada tal como la usa el snapshot: identidad, autorización y comprador. */
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
  treatments: readonly InvoiceTaxTreatment[];
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

/** Catálogos de los que depende la nota: el registro de esquemas, sus tarifas y la forma de pago. */
function usedCatalogs(
  treatments: readonly InvoiceTaxTreatment[],
  datasetVersions: Readonly<Record<string, number>>,
): Record<string, number> {
  const used = new Set([
    "schema-registry",
    "payment-method",
    ...treatments.map((treatment) => treatment.catalogType),
  ]);
  return Object.fromEntries(
    [...used]
      .sort()
      .filter((type) => datasetVersions[type] !== undefined)
      .map((type) => [type, datasetVersions[type]!]),
  );
}

export function buildDebitNoteSnapshot(args: {
  invoice: SourceInvoice;
  config: IssuerConfig;
  point: IssuerPoint;
  schema: DebitNoteSnapshotDraft["schema"];
  builderVersion: string;
  datasetVersions: Readonly<Record<string, number>>;
  issueDate: string;
  concepts: readonly ResolvedConcept[];
  amounts: DebitNoteAmounts;
  payment: DebitNotePayment;
  declarations: DebitNoteSnapshotDraft["declarations"];
}): DebitNoteSnapshotDraft {
  const { invoice, config, point, amounts, payment } = args;
  const bases = new Map(amounts.concepts.map((concept) => [concept.position, concept.base]));
  if (args.concepts.length === 0 || args.concepts.some((c) => !bases.has(c.position))) {
    throw new Error("Los conceptos no son los del cálculo: no se construye el snapshot.");
  }
  if (payment.amount !== amounts.total) {
    throw new Error("La forma de pago no cubre el valor total: no se construye el snapshot.");
  }
  const used = new Set(amounts.taxes.map((tax) => tax.key));
  const { profile } = config;
  return {
    snapshotVersion: DEBIT_NOTE_SNAPSHOT_VERSION,
    schema: args.schema,
    builderVersion: args.builderVersion,
    calculationVersion: amounts.calculationVersion,
    catalogDatasets: usedCatalogs(
      invoice.treatments.filter((treatment) => used.has(treatment.key)),
      args.datasetVersions,
    ),
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
      taxTreatments: invoice.treatments.map((treatment) => ({ ...treatment })),
    },
    concepts: args.concepts.map((concept) => ({
      position: concept.position,
      cause: concept.cause,
      description: concept.description,
      amount: bases.get(concept.position)!,
      taxTreatment: concept.taxTreatment,
    })),
    taxes: amounts.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
      taxCode,
      rateCode,
      percentage,
      base,
      amount,
    })),
    totals: { withoutTaxes: amounts.withoutTaxes, total: amounts.total },
    payments: [
      {
        position: 1,
        entryKey: payment.entryKey,
        code: payment.code,
        catalogType: payment.catalogType,
        versionId: payment.versionId,
        datasetVersion: payment.datasetVersion,
        officialLabel: payment.officialLabel,
        amount: payment.amount,
      },
    ] satisfies DebitNoteSnapshot["payments"],
    declarations: args.declarations,
  };
}

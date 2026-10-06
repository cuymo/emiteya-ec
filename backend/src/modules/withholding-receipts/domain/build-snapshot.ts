// Construcción del snapshot del comprobante de retención en la transacción de reserva
// (add-withholding-receipts, design D14): desde la evaluación sin problemas (documentos y entradas
// resueltos con la fecha de la reserva), el resultado del cálculo único, el sujeto leído en esa
// transacción y los datos del emisor vigentes al reservar. Desde ese momento el comprobante no vuelve
// a leer el tercero, los catálogos ni la configuración para construir su XML o su RIDE.
import type { WithholdingAmounts } from "./amounts.ts";
import type { CatalogVersion, ResolvedSupport, WithheldSubject } from "./evaluation.ts";
import {
  WITHHOLDING_SNAPSHOT_VERSION,
  type WithholdingCatalogRef,
  type WithholdingSnapshotDraft,
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
  }>;
}>;

export type IssuerPoint = Readonly<{
  point: Readonly<{ id: string; code: string }>;
  establishment: Readonly<{ id: string; code: string; address: string }>;
}>;

const ref = (version: CatalogVersion): WithholdingCatalogRef => ({
  catalogType: version.catalogType,
  entryKey: version.entryKey,
  versionId: version.versionId,
  datasetVersion: version.datasetVersion,
});

/** Catálogos de los que depende el comprobante, con la versión aplicada de su dataset. */
function usedCatalogs(
  supports: readonly ResolvedSupport[],
  datasetVersions: Readonly<Record<string, number>>,
): Record<string, number> {
  const used = new Set(["schema-registry"]);
  for (const support of supports) {
    used.add(support.documentType.catalogType);
    used.add(support.supportCode.catalogType);
    for (const tax of support.taxes) {
      used.add(tax.taxEntry.catalogType);
      used.add(tax.rate.catalogType);
    }
    for (const payment of support.payments) used.add(payment.entry.catalogType);
    for (const item of support.withholdings) {
      used.add(item.taxEntry.catalogType);
      used.add(item.entry.catalogType);
    }
  }
  return Object.fromEntries(
    [...used]
      .sort()
      .filter((type) => datasetVersions[type] !== undefined)
      .map((type) => [type, datasetVersions[type]!]),
  );
}

export function buildWithholdingSnapshot(args: {
  subject: WithheldSubject;
  relatedParty: "SI" | "NO";
  fiscalPeriod: string;
  declared: Readonly<{ by: string; byName: string | null; at: Date }>;
  supports: readonly ResolvedSupport[];
  amounts: WithholdingAmounts;
  config: IssuerConfig;
  point: IssuerPoint;
  schema: WithholdingSnapshotDraft["schema"];
  builderVersion: string;
  datasetVersions: Readonly<Record<string, number>>;
  issueDate: string;
}): WithholdingSnapshotDraft {
  const { supports, amounts, config, point } = args;
  const calculated = new Map(
    amounts.items.map((item) => [`${item.support}:${item.position}`, item]),
  );
  const items = supports.flatMap((support) => support.withholdings);
  if (
    supports.length === 0 ||
    items.length === 0 ||
    items.length !== amounts.items.length ||
    items.some((item) => !calculated.has(`${item.support}:${item.position}`))
  ) {
    throw new Error("Las retenciones no son las del cálculo: no se construye el snapshot.");
  }
  const { profile } = config;
  return {
    snapshotVersion: WITHHOLDING_SNAPSHOT_VERSION,
    schema: args.schema,
    builderVersion: args.builderVersion,
    calculationVersion: amounts.calculationVersion,
    catalogDatasets: usedCatalogs(supports, args.datasetVersions),
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
    subject: {
      partyId: args.subject.id,
      identificationType: args.subject.identificationType,
      identification: args.subject.identification,
      legalName: args.subject.legalName,
    },
    relatedParty: {
      value: args.relatedParty,
      basis: "USER_DECLARED",
      declaredBy: args.declared.by,
      declaredByName: args.declared.byName,
      declaredAt: args.declared.at.toISOString(),
    },
    fiscalPeriod: args.fiscalPeriod,
    supports: supports.map((support) => ({
      position: support.position,
      documentType: {
        code: support.documentType.code as "01" | "02" | "03",
        label: support.documentType.officialLabel,
        ref: ref(support.documentType),
      },
      supportCode: {
        code: support.supportCode.code,
        label: support.supportCode.officialLabel,
        ref: ref(support.supportCode),
      },
      number: support.number,
      issueDate: support.issueDate,
      authorizationNumber: support.authorizationNumber,
      totalWithoutTaxes: support.totalWithoutTaxes,
      importTotal: support.importTotal,
      taxes: support.taxes.map((tax) => ({
        position: tax.position,
        taxCode: tax.tax,
        taxLabel: tax.taxEntry.officialLabel,
        taxRef: ref(tax.taxEntry),
        rateCode: tax.rate.code,
        rateLabel: tax.rate.officialLabel,
        rateRef: ref(tax.rate),
        tariff: tax.tariff,
        tariffBasis: tax.tariffBasis,
        base: tax.base,
        amount: tax.amount,
      })),
      payments: support.payments.map((payment) => ({
        position: payment.position,
        code: payment.entry.code,
        label: payment.entry.officialLabel,
        ref: ref(payment.entry),
        total: payment.total,
      })),
      withholdings: support.withholdings.map((item) => {
        const amount = calculated.get(`${item.support}:${item.position}`)!;
        return {
          position: item.position,
          tax: item.tax,
          taxLabel: item.taxEntry.officialLabel,
          taxRef: ref(item.taxEntry),
          code: item.entry.code,
          label: item.entry.officialLabel,
          ref: ref(item.entry),
          base: amount.base,
          percentage: amount.percentage,
          amount: amount.amount,
        };
      }),
    })),
    totals: { withheld: amounts.withheld },
  };
}

// Construcción del snapshot de la guía en la transacción de reserva (add-shipping-guides, design D11
// y D14): desde la evaluación sin problemas (terceros, establecimientos, productos y facturas leídos
// en esa transacción), la declaración de las excepciones con su actor y su momento, y los datos del
// emisor vigentes al reservar. Desde ese momento la guía no vuelve a leer nada para su XML o su RIDE.
import { SHIPPING_EXCEPTION_POLICY } from "@facturador/contracts";
import type { ResolvedShippingGuide } from "./evaluation.ts";
import {
  SHIPPING_GUIDE_SNAPSHOT_VERSION,
  type ShippingGuideSnapshotDraft,
  type ShippingGuideSnapshotSupport,
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

/** Quién declaró las excepciones y cuándo: el usuario que emite, en el momento de la reserva. */
export type ExceptionDeclaration = Readonly<{
  policyVersion: number;
  by: string;
  byName: string | null;
  at: Date;
}>;

export function buildShippingGuideSnapshot(args: {
  guide: ResolvedShippingGuide;
  /** Obligatoria si algún destinatario declara una excepción (design D14). */
  declaration: ExceptionDeclaration | null;
  config: IssuerConfig;
  point: IssuerPoint;
  schema: ShippingGuideSnapshotDraft["schema"];
  builderVersion: string;
  datasetVersions: Readonly<Record<string, number>>;
  issueDate: string;
}): ShippingGuideSnapshotDraft {
  const { guide, config, point, declaration } = args;
  const { profile } = config;
  if (guide.recipients.length === 0) {
    throw new Error("Una guía sin destinatarios no tiene snapshot.");
  }
  const supportOf = (
    support: ResolvedShippingGuide["recipients"][number]["support"],
  ): ShippingGuideSnapshotSupport => {
    if (support.kind === "INTERNAL_INVOICE") {
      const { invoice } = support;
      if (!invoice.authorization) throw new Error("La factura sustento no está autorizada.");
      return {
        kind: "INTERNAL_INVOICE",
        invoice: {
          id: invoice.id,
          documentType: "01",
          documentNumber: invoice.documentNumber,
          issueDate: invoice.issueDate,
          accessKey: invoice.accessKey,
          authorization: {
            number: invoice.authorization.number,
            date: invoice.authorization.date.toISOString(),
            environment: invoice.authorization.environment,
          },
        },
      };
    }
    if (declaration === null) {
      throw new Error("Una excepción sin la declaración del usuario no se congela.");
    }
    const policy = SHIPPING_EXCEPTION_POLICY[support.case];
    return {
      kind: "DECLARED_EXCEPTION",
      declaration: {
        case: support.case,
        literal: policy.literal,
        label: policy.label,
        policyVersion: declaration.policyVersion,
        basis: "USER_DECLARED",
        declaredBy: declaration.by,
        declaredByName: declaration.byName,
        declaredAt: declaration.at.toISOString(),
      },
    };
  };
  return {
    snapshotVersion: SHIPPING_GUIDE_SNAPSHOT_VERSION,
    schema: args.schema,
    builderVersion: args.builderVersion,
    catalogDatasets:
      args.datasetVersions["schema-registry"] === undefined
        ? {}
        : { "schema-registry": args.datasetVersions["schema-registry"] },
    taxpayerConfig: { versionId: config.versionId, version: config.version },
    issueDate: args.issueDate,
    environment: config.environment,
    environmentCode: ENVIRONMENT_CODES[config.environment],
    issuer: {
      ruc: profile.ruc,
      legalName: profile.legalName,
      tradeName: profile.tradeName,
      headOfficeAddress: profile.headOfficeAddress,
      establishment: { ...point.establishment },
      emissionPoint: { id: point.point.id, code: point.point.code },
      accountingRequired: profile.accountingRequired,
      specialTaxpayerNumber: profile.specialTaxpayerNumber,
      withholdingAgentResolution: profile.withholdingAgentResolution,
      rimpeCategory: profile.rimpeCategory,
    },
    departure: {
      source: guide.departure.source,
      establishment: guide.departure.establishment ? { ...guide.departure.establishment } : null,
      address: guide.departure.address,
    },
    transporter: { ...guide.carrier },
    plate: guide.plate,
    transportStart: guide.transportStart,
    transportEnd: guide.transportEnd,
    recipients: guide.recipients.map((recipient) => ({
      position: recipient.position,
      kind: recipient.kind,
      partyId: recipient.partyId,
      destination: recipient.destination ? { ...recipient.destination } : null,
      identificationType: recipient.identificationType,
      identification: recipient.identification,
      legalName: recipient.legalName,
      address: recipient.address,
      motive: recipient.motive,
      route: recipient.route,
      destinationEstablishmentCode: recipient.destinationEstablishmentCode,
      support: supportOf(recipient.support),
      details: recipient.details.map((detail) => ({ ...detail })),
    })),
    counts: { ...guide.counts },
  };
}

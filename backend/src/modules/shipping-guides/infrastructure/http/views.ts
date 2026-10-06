// Vistas de las guías de remisión (add-shipping-guides, design D22): el borrador con su vista previa,
// los terceros de las búsquedas y las facturas elegibles. Sin XML, respuestas originales ni datos
// técnicos.
import type {
  ShippingEligibleInvoiceView,
  ShippingGuideDraftSummaryView,
  ShippingGuideDraftView,
  ShippingGuideSummaryView,
  ShippingGuideTransmissionView,
  ShippingGuideView,
  ShippingRecipientPartyView,
  SriMessageView,
} from "@facturador/contracts";
import { stopMessage } from "../../../fiscal/application/transmission-messages.ts";
import { isAttemptCode, shippingGuideDiagnosticMessage } from "../../application/diagnostics.ts";
import type { ShippingGuideDraftDetails } from "../../application/drafts.ts";
import { carrierView } from "../../application/options.ts";
import type { EligibleInvoice } from "../../application/ports.ts";
import type {
  ShippingGuideDetails,
  ShippingGuideListItem,
  ShippingGuideTransmission,
} from "../../application/shipping-guides.ts";
import type { ShippingGuideDraftRecord } from "../../domain/draft.ts";
import type { GuideParty } from "../../domain/evaluation.ts";
import type { ShippingGuideSnapshot } from "../../domain/snapshot.ts";

export const toRecipientPartyView = (party: GuideParty): ShippingRecipientPartyView => ({
  id: party.id,
  identificationType: party.identificationType,
  identification: party.identification,
  legalName: party.legalName,
  address: party.address,
});

export const toEligibleInvoiceView = (invoice: EligibleInvoice): ShippingEligibleInvoiceView => ({
  ...invoice,
});

export function toShippingGuideDraftView({
  draft,
  context,
  preview,
}: ShippingGuideDraftDetails): ShippingGuideDraftView {
  const { point, parties, establishments, products, invoices } = context;
  const establishmentRef = (id: string) => {
    const found = establishments.get(id);
    return found ? { id: found.id, code: found.code, address: found.address } : null;
  };
  return {
    id: draft.id,
    version: draft.version,
    emissionPoint: point
      ? {
          id: point.point.id,
          establishmentCode: point.establishment.code,
          code: point.point.code,
          available: point.available,
        }
      : null,
    originEstablishment: draft.originEstablishmentId
      ? establishmentRef(draft.originEstablishmentId)
      : null,
    departureAddress: draft.departureAddress,
    transporter:
      draft.transporter === null
        ? null
        : draft.transporter.source === "SELF"
          ? { source: "SELF" }
          : {
              source: "PARTY",
              partyId: draft.transporter.partyId,
              party: parties.has(draft.transporter.partyId)
                ? carrierView(parties.get(draft.transporter.partyId)!)
                : null,
            },
    plate: draft.plate,
    transportStart: draft.transportStart,
    transportEnd: draft.transportEnd,
    recipients: draft.recipients.map((recipient) => ({
      recipient:
        recipient.recipient === null
          ? null
          : recipient.recipient.kind === "PARTY"
            ? {
                kind: "PARTY",
                partyId: recipient.recipient.partyId,
                party: parties.has(recipient.recipient.partyId)
                  ? toRecipientPartyView(parties.get(recipient.recipient.partyId)!)
                  : null,
              }
            : {
                kind: "OWN_COMPANY",
                destinationEstablishmentId: recipient.recipient.destinationEstablishmentId,
                establishment: establishmentRef(recipient.recipient.destinationEstablishmentId),
              },
      address: recipient.address,
      motive: recipient.motive,
      route: recipient.route,
      destinationEstablishmentCode: recipient.destinationEstablishmentCode,
      support:
        recipient.support === null
          ? null
          : recipient.support.kind === "INTERNAL_INVOICE"
            ? {
                kind: "INTERNAL_INVOICE",
                invoiceId: recipient.support.invoiceId,
                documentNumber: invoices.get(recipient.support.invoiceId)?.documentNumber ?? null,
              }
            : { kind: "DECLARED_EXCEPTION", case: recipient.support.case },
      details: recipient.details.map((detail) => ({
        productId: detail.productId,
        productName: detail.productId ? (products.get(detail.productId)?.name ?? null) : null,
        mainCode: detail.mainCode,
        auxiliaryCode: detail.auxiliaryCode,
        description: detail.description,
        quantity: detail.quantity,
      })),
    })),
    preview,
    createdAt: draft.createdAt.toISOString(),
    createdBy: draft.createdBy,
    updatedAt: draft.updatedAt.toISOString(),
    updatedBy: draft.updatedBy,
  };
}

/** Resumen de un borrador para la lista, sin leer nada más que el borrador. */
export const toShippingGuideDraftSummaryView = (
  draft: ShippingGuideDraftRecord,
  carrierName: string | null,
): ShippingGuideDraftSummaryView => ({
  id: draft.id,
  version: draft.version,
  carrierName,
  recipientCount: draft.recipients.length,
  detailCount: draft.recipients.reduce((sum, recipient) => sum + recipient.details.length, 0),
  transportStart: draft.transportStart,
  updatedAt: draft.updatedAt.toISOString(),
});

export const messagesView = (messages: readonly SriMessageView[]): SriMessageView[] =>
  messages.map(({ identifier, message, additionalInformation, type }) => ({
    identifier,
    message,
    additionalInformation,
    type,
  }));

function diagnosticView({ document }: ShippingGuideDetails): ShippingGuideView["diagnostic"] {
  const attempt = document.lastAttempt;
  if (document.state !== "RESERVED" || !attempt || !isAttemptCode(attempt.code)) return null;
  return {
    stage: attempt.stage as NonNullable<ShippingGuideView["diagnostic"]>["stage"],
    code: attempt.code,
    class: attempt.class,
    message: shippingGuideDiagnosticMessage(attempt.code, attempt.detail),
    at: attempt.at.toISOString(),
    attemptCount: document.attemptCount,
  };
}

function transmissionView({
  document,
  transmission,
}: ShippingGuideDetails): ShippingGuideView["transmission"] {
  return {
    inProgress: transmission.inProgress,
    stopped: transmission.stopped
      ? {
          code: transmission.stopped.code,
          message: stopMessage(transmission.stopped.code),
          at: transmission.stopped.at.toISOString(),
        }
      : null,
    reconcilable: transmission.reconcilable,
    authorization: document.authorization
      ? {
          number: document.authorization.number,
          authorizedAt: document.authorization.date.toISOString(),
          environment: document.authorization.environment,
        }
      : null,
    lastResult: transmission.lastResult
      ? {
          operation: transmission.lastResult.operation,
          outcome: transmission.lastResult.outcome,
          at: transmission.lastResult.at.toISOString(),
          messages: messagesView(transmission.lastResult.messages),
        }
      : null,
  };
}

/**
 * Guía desde su snapshot: lo que se emitió, sin releer terceros, establecimientos, productos ni
 * facturas. Una excepción se presenta como declarada por el usuario, nunca como verificada.
 */
export function toShippingGuideView(details: ShippingGuideDetails): ShippingGuideView {
  const { document, artifact, authorizedArtifact } = details;
  const snapshot = document.snapshot as ShippingGuideSnapshot;
  const { issuer, departure, transporter } = snapshot;
  return {
    id: document.id,
    documentType: document.documentType,
    environment: document.environment,
    documentNumber: document.documentNumber,
    accessKey: document.accessKey,
    issueDate: document.issueDate,
    state: document.state,
    issuer: {
      ruc: issuer.ruc,
      legalName: issuer.legalName,
      tradeName: issuer.tradeName,
      headOfficeAddress: issuer.headOfficeAddress,
      establishmentAddress: issuer.establishment.address,
      accountingRequired: issuer.accountingRequired,
      specialTaxpayerNumber: issuer.specialTaxpayerNumber,
      withholdingAgentResolution: issuer.withholdingAgentResolution,
      rimpeCategory: issuer.rimpeCategory,
    },
    departure: {
      source: departure.source,
      establishment: departure.establishment
        ? {
            id: departure.establishment.id,
            code: departure.establishment.code,
            address: departure.establishment.address,
          }
        : null,
      address: departure.address,
    },
    transporter: {
      source: transporter.source,
      partyId: transporter.partyId,
      identificationType: transporter.identificationType,
      identification: transporter.identification,
      legalName: transporter.legalName,
    },
    plate: snapshot.plate,
    transportStart: snapshot.transportStart,
    transportEnd: snapshot.transportEnd,
    recipients: snapshot.recipients.map((recipient) => ({
      position: recipient.position,
      kind: recipient.kind,
      partyId: recipient.partyId,
      destinationEstablishment: recipient.destination
        ? {
            id: recipient.destination.id,
            code: recipient.destination.code,
            address: recipient.destination.address,
          }
        : null,
      identificationType: recipient.identificationType,
      identification: recipient.identification,
      legalName: recipient.legalName,
      address: recipient.address,
      motive: recipient.motive,
      route: recipient.route,
      destinationEstablishmentCode: recipient.destinationEstablishmentCode,
      support:
        recipient.support.kind === "INTERNAL_INVOICE"
          ? {
              kind: "INTERNAL_INVOICE",
              invoice: {
                id: recipient.support.invoice.id,
                documentType: "01",
                documentNumber: recipient.support.invoice.documentNumber,
                issueDate: recipient.support.invoice.issueDate,
                authorizationNumber: recipient.support.invoice.authorization.number,
              },
            }
          : {
              kind: "DECLARED_EXCEPTION",
              declaration: {
                case: recipient.support.declaration.case,
                literal: recipient.support.declaration.literal,
                label: recipient.support.declaration.label,
                policyVersion: recipient.support.declaration.policyVersion,
                basis: "USER_DECLARED",
                declaredBy: recipient.support.declaration.declaredBy,
                declaredByName: recipient.support.declaration.declaredByName,
                declaredAt: recipient.support.declaration.declaredAt,
              },
            },
      details: recipient.details.map((detail) => ({
        position: detail.position,
        productId: detail.productId,
        mainCode: detail.mainCode,
        auxiliaryCode: detail.auxiliaryCode,
        description: detail.description,
        quantity: detail.quantity,
      })),
    })),
    counts: { recipients: snapshot.counts.recipients, details: snapshot.counts.details },
    diagnostic: diagnosticView(details),
    artifact: artifact ? { sha256: artifact.sha256, sizeBytes: artifact.sizeBytes } : null,
    authorizedArtifact: authorizedArtifact
      ? { sha256: authorizedArtifact.sha256, sizeBytes: authorizedArtifact.sizeBytes }
      : null,
    transmission: transmissionView(details),
    createdAt: document.createdAt.toISOString(),
    signedAt: document.signedAt?.toISOString() ?? null,
  };
}

/** Fila de la lista desde el snapshot: el transportista y "N destinatarios" o el nombre, sin importes. */
export function toShippingGuideSummaryView({
  document,
  transmissionStopped,
}: ShippingGuideListItem): ShippingGuideSummaryView {
  const snapshot = document.snapshot as ShippingGuideSnapshot;
  const attempt = document.lastAttempt;
  return {
    id: document.id,
    documentNumber: document.documentNumber,
    environment: document.environment,
    issueDate: document.issueDate,
    carrierName: snapshot.transporter.legalName,
    recipients: {
      count: snapshot.recipients.length,
      name: snapshot.recipients.length === 1 ? snapshot.recipients[0]!.legalName : null,
    },
    transportStart: snapshot.transportStart,
    transportEnd: snapshot.transportEnd,
    state: document.state,
    diagnosticCode:
      document.state === "RESERVED" && attempt && isAttemptCode(attempt.code) ? attempt.code : null,
    transmissionStopped,
    createdAt: document.createdAt.toISOString(),
  };
}

/** Historial de la transmisión: transiciones e intentos resumidos (design D18). */
export function toShippingGuideTransmissionView({
  document,
  events,
  total,
}: ShippingGuideTransmission): ShippingGuideTransmissionView {
  return {
    shippingGuideId: document.id,
    state: document.state,
    events: events.map((event) =>
      event.kind === "TRANSITION"
        ? {
            kind: "TRANSITION",
            at: event.at.toISOString(),
            fromState: event.from,
            toState: event.to,
            cause: event.cause,
            actor: event.actor,
            actorName: event.actorName,
          }
        : {
            kind: "ATTEMPT",
            at: event.at.toISOString(),
            operation: event.operation,
            origin: event.origin,
            outcome: event.outcome,
            messages: messagesView(event.messages),
          },
    ),
    total,
  };
}

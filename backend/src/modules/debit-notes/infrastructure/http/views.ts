// Vistas de las notas de débito (add-debit-notes, design D20): el borrador con su vista previa, la
// nota desde su snapshot y las facturas elegibles. Sin XML, respuestas originales ni datos técnicos.
import {
  DEBIT_NOTE_CAUSES,
  DEBIT_NOTE_ELIGIBILITY_DECLARATION,
  type DebitEligibleInvoiceView,
  type DebitNoteDraftSummaryView,
  type DebitNoteDraftView,
  type DebitNoteSummaryView,
  type DebitNoteTransmissionView,
  type DebitNoteView,
  type SriMessageView,
} from "@facturador/contracts";
import { roundHalfUp } from "../../../../platform/decimal/fiscal-decimal.ts";
import { stopMessage } from "../../../invoices/application/transmission-messages.ts";
import type {
  DebitNoteDetails,
  DebitNoteListItem,
  DebitNoteTransmission,
} from "../../application/debit-notes.ts";
import { debitNoteDiagnosticMessage, isAttemptCode } from "../../application/diagnostics.ts";
import type { DebitNoteDraftDetails } from "../../application/drafts.ts";
import type { DebitEligibleInvoice } from "../../application/ports.ts";
import type { DebitNoteSnapshot } from "../../domain/snapshot.ts";

export function toDebitNoteDraftView({
  draft,
  context,
  preview,
}: DebitNoteDraftDetails): DebitNoteDraftView {
  const { invoice, point } = context;
  return {
    id: draft.id,
    version: draft.version,
    invoice: {
      id: invoice.id,
      documentNumber: invoice.documentNumber,
      issueDate: invoice.issueDate,
      buyerIdentification: invoice.buyer.identification,
      buyerName: invoice.buyer.legalName,
      // Un snapshot sin forma no tiene totales: la vista previa ya informa su integridad.
      total: invoice.totals?.total ?? "0.00",
    },
    emissionPoint: point
      ? {
          id: point.point.id,
          establishmentCode: point.establishment.code,
          code: point.point.code,
          available: point.available,
        }
      : null,
    paymentMethod: draft.paymentMethod,
    concepts: draft.concepts.map((concept, index) => ({
      position: index + 1,
      cause: concept.cause,
      description: concept.description,
      amount: concept.amount,
      taxTreatment: concept.taxTreatment,
    })),
    preview,
    createdAt: draft.createdAt.toISOString(),
    createdBy: draft.createdBy,
    updatedAt: draft.updatedAt.toISOString(),
    updatedBy: draft.updatedBy,
  };
}

export function toDebitNoteDraftSummaryView({
  draft,
  context,
  preview,
}: DebitNoteDraftDetails): DebitNoteDraftSummaryView {
  return {
    id: draft.id,
    version: draft.version,
    invoice: {
      id: context.invoice.id,
      documentNumber: context.invoice.documentNumber,
      issueDate: context.invoice.issueDate,
    },
    buyerName: context.invoice.buyer.legalName,
    conceptCount: draft.concepts.length,
    previewTotal: preview.totals?.total ?? null,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

export const toDebitEligibleInvoiceView = (
  invoice: DebitEligibleInvoice,
): DebitEligibleInvoiceView => ({ ...invoice });

export const messagesView = (messages: readonly SriMessageView[]): SriMessageView[] =>
  messages.map(({ identifier, message, additionalInformation, type }) => ({
    identifier,
    message,
    additionalInformation,
    type,
  }));

function diagnosticView({ document }: DebitNoteDetails): DebitNoteView["diagnostic"] {
  const attempt = document.lastAttempt;
  if (document.state !== "RESERVED" || !attempt || !isAttemptCode(attempt.code)) return null;
  return {
    stage: attempt.stage as NonNullable<DebitNoteView["diagnostic"]>["stage"],
    code: attempt.code,
    class: attempt.class,
    message: debitNoteDiagnosticMessage(attempt.code, attempt.detail),
    at: attempt.at.toISOString(),
    attemptCount: document.attemptCount,
  };
}

function transmissionView({
  document,
  transmission,
}: DebitNoteDetails): DebitNoteView["transmission"] {
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

const STATEMENTS = new Map(
  DEBIT_NOTE_ELIGIBILITY_DECLARATION.statements.map((statement) => [statement.id, statement]),
);

/** Nota desde su snapshot: lo que se emitió, sin releer la factura, el catálogo ni la configuración. */
export function toDebitNoteView(details: DebitNoteDetails): DebitNoteView {
  const { document, artifact, authorizedArtifact } = details;
  const snapshot = document.snapshot as DebitNoteSnapshot;
  const { issuer, buyer, invoice, declarations } = snapshot;
  const treatments = new Map(invoice.taxTreatments.map((treatment) => [treatment.key, treatment]));
  const labelOf = (key: string) => treatments.get(key)?.officialLabel ?? key;
  const [payment] = snapshot.payments;
  return {
    id: document.id,
    documentType: document.documentType,
    environment: document.environment,
    documentNumber: document.documentNumber,
    accessKey: document.accessKey,
    issueDate: document.issueDate,
    state: document.state,
    invoice: {
      id: invoice.id,
      documentNumber: invoice.documentNumber,
      issueDate: invoice.issueDate,
      accessKey: invoice.accessKey,
      authorizationNumber: invoice.authorizationNumber,
    },
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
    buyer: {
      identificationType: buyer.identificationType,
      identification: buyer.identification,
      legalName: buyer.legalName,
      address: buyer.address,
    },
    concepts: snapshot.concepts.map((concept) => {
      const treatment = treatments.get(concept.taxTreatment);
      return {
        position: concept.position,
        cause: concept.cause,
        description: concept.description,
        amount: concept.amount,
        taxTreatment: {
          key: concept.taxTreatment,
          taxCode: treatment?.taxCode ?? "",
          rateCode: treatment?.rateCode ?? "",
          percentage: treatment?.percentage ?? "0",
          label: labelOf(concept.taxTreatment),
        },
      };
    }),
    totals: {
      withoutTaxes: snapshot.totals.withoutTaxes,
      taxes: snapshot.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => {
        const key = `${taxCode}:${rateCode}`;
        return { key, taxCode, rateCode, percentage, label: labelOf(key), base, amount };
      }),
      total: snapshot.totals.total,
    },
    payment: {
      entryKey: payment.entryKey,
      code: payment.code,
      label: payment.officialLabel,
      amount: payment.amount,
    },
    declarations: {
      version: declarations.version,
      statements: declarations.statements.map((id) => ({
        id,
        text: STATEMENTS.get(id)?.text ?? id,
        source: STATEMENTS.get(id)?.source ?? "",
      })),
      basis: "USER_DECLARED",
      declaredBy: declarations.declaredBy,
      declaredByName: details.declaredByName,
      declaredAt: declarations.declaredAt,
    },
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

export function toDebitNoteSummaryView({
  document,
  transmissionStopped,
}: DebitNoteListItem): DebitNoteSummaryView {
  const snapshot = document.snapshot as DebitNoteSnapshot;
  const attempt = document.lastAttempt;
  return {
    id: document.id,
    documentNumber: document.documentNumber,
    environment: document.environment,
    issueDate: document.issueDate,
    invoice: { id: snapshot.invoice.id, documentNumber: snapshot.invoice.documentNumber },
    causes: DEBIT_NOTE_CAUSES.filter((cause) => snapshot.concepts.some((c) => c.cause === cause)),
    buyerIdentification: document.buyerIdentification,
    buyerName: document.buyerName,
    total: roundHalfUp(document.total, 2),
    state: document.state,
    diagnosticCode:
      document.state === "RESERVED" && attempt && isAttemptCode(attempt.code) ? attempt.code : null,
    transmissionStopped,
    createdAt: document.createdAt.toISOString(),
  };
}

/** Historial de la transmisión: transiciones e intentos resumidos (design D17). */
export function toDebitNoteTransmissionView({
  document,
  events,
  total,
}: DebitNoteTransmission): DebitNoteTransmissionView {
  return {
    debitNoteId: document.id,
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

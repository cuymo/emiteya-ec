// Vistas de las notas de crédito (add-credit-notes, design D16): el borrador con su vista previa, la
// nota desde su snapshot y las facturas elegibles. Sin XML, respuestas originales ni datos técnicos.
import {
  CREDIT_NOTE_ELIGIBILITY_DECLARATION,
  compareDecimalStrings,
  type CreditNoteDraftSummaryView,
  type CreditNoteDraftView,
  type CreditNoteSummaryView,
  type CreditNoteTransmissionView,
  type CreditNoteView,
  type EligibleInvoiceView,
  type InvoiceCreditView,
  type SriMessageView,
} from "@facturador/contracts";
import {
  roundHalfUp,
  subtractExact,
  sumExact,
} from "../../../../platform/decimal/fiscal-decimal.ts";
import { stopMessage } from "../../../invoices/application/transmission-messages.ts";
import type {
  CreditNoteDetails,
  CreditNoteListItem,
  CreditNoteTransmission,
  InvoiceCredit,
} from "../../application/credit-notes.ts";
import { creditNoteDiagnosticMessage, isAttemptCode } from "../../application/diagnostics.ts";
import type { CreditNoteDraftDetails } from "../../application/drafts.ts";
import type { EligibleInvoice } from "../../application/ports.ts";
import type { CreditNoteSnapshot } from "../../domain/snapshot.ts";

export function toCreditNoteDraftView({
  draft,
  context,
  preview,
}: CreditNoteDraftDetails): CreditNoteDraftView {
  const { invoice, point } = context;
  const lines = new Map(invoice.lines.map((line) => [line.position, line]));
  return {
    id: draft.id,
    version: draft.version,
    invoice: {
      id: invoice.id,
      documentNumber: invoice.documentNumber,
      issueDate: invoice.issueDate,
      buyerIdentification: invoice.buyer.identification,
      buyerName: invoice.buyer.legalName,
      total: invoice.totals.total,
    },
    emissionPoint: point
      ? {
          id: point.point.id,
          establishmentCode: point.establishment.code,
          code: point.point.code,
          available: point.available,
        }
      : null,
    cause: draft.cause,
    reason: draft.reason,
    lines: draft.lines.map((line) => ({
      position: line.position,
      quantity: line.quantity ?? lines.get(line.position)?.quantity ?? "0",
      physicalReturn: line.physicalReturn,
    })),
    preview,
    createdAt: draft.createdAt.toISOString(),
    createdBy: draft.createdBy,
    updatedAt: draft.updatedAt.toISOString(),
    updatedBy: draft.updatedBy,
  };
}

export function toCreditNoteDraftSummaryView({
  draft,
  context,
  preview,
}: CreditNoteDraftDetails): CreditNoteDraftSummaryView {
  return {
    id: draft.id,
    version: draft.version,
    invoice: {
      id: context.invoice.id,
      documentNumber: context.invoice.documentNumber,
      issueDate: context.invoice.issueDate,
    },
    cause: draft.cause,
    buyerName: context.invoice.buyer.legalName,
    lineCount: preview.lines.length,
    previewTotal: preview.totals?.total ?? null,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

export const toEligibleInvoiceView = (invoice: EligibleInvoice): EligibleInvoiceView => ({
  ...invoice,
});

const messagesView = (messages: readonly SriMessageView[]): SriMessageView[] =>
  messages.map(({ identifier, message, additionalInformation, type }) => ({
    identifier,
    message,
    additionalInformation,
    type,
  }));

function diagnosticView({ document }: CreditNoteDetails): CreditNoteView["diagnostic"] {
  const attempt = document.lastAttempt;
  if (document.state !== "RESERVED" || !attempt || !isAttemptCode(attempt.code)) return null;
  return {
    stage: attempt.stage as NonNullable<CreditNoteView["diagnostic"]>["stage"],
    code: attempt.code,
    class: attempt.class,
    message: creditNoteDiagnosticMessage(attempt.code, attempt.detail),
    at: attempt.at.toISOString(),
    attemptCount: document.attemptCount,
  };
}

function transmissionView({
  document,
  transmission,
}: CreditNoteDetails): CreditNoteView["transmission"] {
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
  CREDIT_NOTE_ELIGIBILITY_DECLARATION.statements.map((statement) => [statement.id, statement]),
);

/** Nota desde su snapshot: lo que se emitió, sin releer la factura, el producto ni el catálogo. */
export function toCreditNoteView(details: CreditNoteDetails): CreditNoteView {
  const { document, artifact, authorizedArtifact } = details;
  const snapshot = document.snapshot as CreditNoteSnapshot;
  const { issuer, buyer, invoice, declarations } = snapshot;
  return {
    id: document.id,
    documentType: document.documentType,
    environment: document.environment,
    documentNumber: document.documentNumber,
    accessKey: document.accessKey,
    issueDate: document.issueDate,
    state: document.state,
    cause: snapshot.cause,
    reason: snapshot.reason,
    invoice: {
      id: invoice.id,
      documentNumber: invoice.documentNumber,
      issueDate: invoice.issueDate,
      accessKey: invoice.accessKey,
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
    lines: snapshot.lines.map((line) => ({
      position: line.invoicePosition,
      mainCode: line.mainCode,
      auxiliaryCode: line.auxiliaryCode,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      taxableBase: line.taxableBase,
      taxes: line.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
        taxCode,
        rateCode,
        percentage,
        base,
        amount,
      })),
      physicalReturn: line.physicalReturn,
    })),
    totals: {
      withoutTaxes: snapshot.totals.withoutTaxes,
      taxes: snapshot.totals.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
        taxCode,
        rateCode,
        percentage,
        base,
        amount,
      })),
      total: snapshot.totals.total,
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

const money = (value: string) => roundHalfUp(value, 2);

export function toCreditNoteSummaryView({
  document,
  transmissionStopped,
}: CreditNoteListItem): CreditNoteSummaryView {
  const snapshot = document.snapshot as CreditNoteSnapshot;
  const attempt = document.lastAttempt;
  return {
    id: document.id,
    documentNumber: document.documentNumber,
    environment: document.environment,
    issueDate: document.issueDate,
    invoice: { id: snapshot.invoice.id, documentNumber: snapshot.invoice.documentNumber },
    cause: snapshot.cause,
    buyerIdentification: document.buyerIdentification,
    buyerName: document.buyerName,
    total: money(document.total),
    state: document.state,
    diagnosticCode:
      document.state === "RESERVED" && attempt && isAttemptCode(attempt.code) ? attempt.code : null,
    transmissionStopped,
    createdAt: document.createdAt.toISOString(),
  };
}

/** Historial de la transmisión: transiciones e intentos resumidos (design D13). */
export function toCreditNoteTransmissionView({
  document,
  events,
  total,
}: CreditNoteTransmission): CreditNoteTransmissionView {
  return {
    creditNoteId: document.id,
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

/** Crédito de una factura: aplicado, reservado, disponible y por línea (design D16). */
export function toInvoiceCreditView({
  invoice,
  capacity,
  returnable,
}: InvoiceCredit): InvoiceCreditView {
  const lines = new Map(capacity.lines.map((line) => [line.position, line]));
  const total = invoice.totals.total;
  const credited = sumExact([capacity.reserved, capacity.applied]);
  return {
    invoiceId: invoice.id,
    documentNumber: invoice.documentNumber,
    issueDate: invoice.issueDate,
    buyerIdentification: invoice.buyer.identification,
    buyerName: invoice.buyer.legalName,
    consumerFinal: invoice.consumerFinal,
    total: money(total),
    applied: money(capacity.applied),
    reserved: money(capacity.reserved),
    available: money(subtractExact(total, credited)),
    totalAnnulmentAvailable: compareDecimalStrings(credited, "0") === 0,
    lines: invoice.lines.map((line) => {
      const state = lines.get(line.position);
      const reserved = state?.reserved ?? "0";
      const applied = state?.applied ?? "0";
      const returns = line.inventoryAffectsStock ? returnable.get(line.productId) : undefined;
      return {
        position: line.position,
        productId: line.productId,
        mainCode: line.mainCode,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        taxableBase: line.taxableBase,
        taxes: line.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
          taxCode,
          rateCode,
          percentage,
          base,
          amount,
        })),
        inventoryAffectsStock: line.inventoryAffectsStock,
        credited: {
          applied,
          reserved,
          available: subtractExact(subtractExact(line.quantity, applied), reserved),
        },
        returnable: returns
          ? {
              original: returns.original,
              applied: returns.applied,
              reserved: returns.reserved,
              available: subtractExact(
                subtractExact(returns.original, returns.applied),
                returns.reserved,
              ),
            }
          : null,
      };
    }),
  };
}

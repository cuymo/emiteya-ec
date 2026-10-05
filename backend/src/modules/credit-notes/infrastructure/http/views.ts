// Vistas de las notas de crédito (add-credit-notes, design D16): el borrador con su vista previa, la
// nota desde su snapshot y las facturas elegibles. Sin XML, respuestas originales ni datos técnicos.
import {
  CREDIT_NOTE_ELIGIBILITY_DECLARATION,
  type CreditNoteDraftSummaryView,
  type CreditNoteDraftView,
  type CreditNoteView,
  type EligibleInvoiceView,
  type SriMessageView,
} from "@facturador/contracts";
import { stopMessage } from "../../../invoices/application/transmission-messages.ts";
import type { CreditNoteDetails } from "../../application/credit-notes.ts";
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

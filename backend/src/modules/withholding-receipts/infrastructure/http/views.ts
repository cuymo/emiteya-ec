// Vistas de los comprobantes de retención (add-withholding-receipts, design D21): el borrador con su
// vista previa, los proveedores y el comprobante desde su snapshot. Sin XML, respuestas originales
// ni datos técnicos.
import type {
  SriMessageView,
  WithholdingDraftSummaryView,
  WithholdingDraftView,
  WithholdingReceiptView,
  WithholdingSupplierView,
} from "@facturador/contracts";
import { stopMessage } from "../../../invoices/application/transmission-messages.ts";
import { isAttemptCode, withholdingDiagnosticMessage } from "../../application/diagnostics.ts";
import type { WithholdingDraftDetails } from "../../application/drafts.ts";
import type { WithholdingReceiptDetails } from "../../application/withholding-receipts.ts";
import type { WithheldSubject } from "../../domain/evaluation.ts";
import type { WithholdingSnapshot } from "../../domain/snapshot.ts";

export const toWithholdingSupplierView = (subject: WithheldSubject): WithholdingSupplierView => ({
  id: subject.id,
  identificationType: subject.identificationType,
  identification: subject.identification,
  legalName: subject.legalName,
});

export function toWithholdingDraftView({
  draft,
  context,
  preview,
}: WithholdingDraftDetails): WithholdingDraftView {
  const { point, subject } = context;
  return {
    id: draft.id,
    version: draft.version,
    party: subject ? toWithholdingSupplierView(subject) : null,
    relatedParty: draft.relatedParty,
    fiscalPeriod: draft.fiscalPeriod,
    emissionPoint: point
      ? {
          id: point.point.id,
          establishmentCode: point.establishment.code,
          code: point.point.code,
          available: point.available,
        }
      : null,
    supports: draft.supports.map((support) => ({
      documentType:
        support.documentType as WithholdingDraftView["supports"][number]["documentType"],
      supportCode: support.supportCode,
      number: support.number,
      issueDate: support.issueDate,
      authorizationNumber: support.authorizationNumber,
      totalWithoutTaxes: support.totalWithoutTaxes,
      importTotal: support.importTotal,
      taxes: support.taxes.map((tax) => ({
        tax: tax.tax as WithholdingDraftView["supports"][number]["taxes"][number]["tax"],
        rateEntryKey: tax.rateEntryKey,
        rate: tax.rate,
        base: tax.base,
        amount: tax.amount,
      })),
      payments: support.payments.map((payment) => ({
        paymentMethod: payment.paymentMethod,
        total: payment.total,
      })),
      withholdings: support.withholdings.map((item) => ({
        tax: item.tax as WithholdingDraftView["supports"][number]["withholdings"][number]["tax"],
        entryKey: item.entryKey,
        base: item.base,
      })),
    })),
    preview,
    createdAt: draft.createdAt.toISOString(),
    createdBy: draft.createdBy,
    updatedAt: draft.updatedAt.toISOString(),
    updatedBy: draft.updatedBy,
  };
}

export function toWithholdingDraftSummaryView({
  draft,
  context,
  preview,
}: WithholdingDraftDetails): WithholdingDraftSummaryView {
  return {
    id: draft.id,
    version: draft.version,
    partyName: context.subject?.legalName ?? null,
    fiscalPeriod: draft.fiscalPeriod,
    supportCount: draft.supports.length,
    withholdingCount: draft.supports.reduce((sum, support) => sum + support.withholdings.length, 0),
    previewTotal: preview.totals?.withheld ?? null,
    updatedAt: draft.updatedAt.toISOString(),
  };
}

export const messagesView = (messages: readonly SriMessageView[]): SriMessageView[] =>
  messages.map(({ identifier, message, additionalInformation, type }) => ({
    identifier,
    message,
    additionalInformation,
    type,
  }));

function diagnosticView({
  document,
}: WithholdingReceiptDetails): WithholdingReceiptView["diagnostic"] {
  const attempt = document.lastAttempt;
  if (document.state !== "RESERVED" || !attempt || !isAttemptCode(attempt.code)) return null;
  return {
    stage: attempt.stage as NonNullable<WithholdingReceiptView["diagnostic"]>["stage"],
    code: attempt.code,
    class: attempt.class,
    message: withholdingDiagnosticMessage(attempt.code, attempt.detail),
    at: attempt.at.toISOString(),
    attemptCount: document.attemptCount,
  };
}

function transmissionView({
  document,
  transmission,
}: WithholdingReceiptDetails): WithholdingReceiptView["transmission"] {
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

/** Retención desde su snapshot: lo que se emitió, sin releer el tercero, los catálogos ni la configuración. */
export function toWithholdingReceiptView(
  details: WithholdingReceiptDetails,
): WithholdingReceiptView {
  const { document, artifact, authorizedArtifact } = details;
  const snapshot = document.snapshot as WithholdingSnapshot;
  const { issuer, subject, relatedParty } = snapshot;
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
    subject: {
      partyId: subject.partyId,
      identificationType: subject.identificationType,
      identification: subject.identification,
      legalName: subject.legalName,
    },
    relatedParty: {
      value: relatedParty.value,
      basis: "USER_DECLARED",
      declaredBy: relatedParty.declaredBy,
      declaredByName: relatedParty.declaredByName,
      declaredAt: relatedParty.declaredAt,
    },
    fiscalPeriod: snapshot.fiscalPeriod,
    supports: snapshot.supports.map((support) => ({
      position: support.position,
      documentType: support.documentType.code,
      documentTypeLabel: support.documentType.label,
      supportCode: support.supportCode.code,
      supportCodeLabel: support.supportCode.label,
      number: support.number,
      issueDate: support.issueDate,
      authorizationNumber: support.authorizationNumber,
      totalWithoutTaxes: support.totalWithoutTaxes,
      importTotal: support.importTotal,
      taxes: support.taxes.map((tax) => ({
        position: tax.position,
        tax: tax.taxCode,
        taxLabel: tax.taxLabel,
        rateCode: tax.rateCode,
        rateLabel: tax.rateLabel,
        rate: tax.tariff,
        rateBasis: tax.tariffBasis,
        base: tax.base,
        amount: tax.amount,
      })),
      payments: support.payments.map((payment) => ({
        position: payment.position,
        code: payment.code,
        label: payment.label,
        total: payment.total,
      })),
      withholdings: support.withholdings.map((item) => ({
        position: item.position,
        tax: item.tax,
        taxLabel: item.taxLabel,
        entryKey: item.ref.entryKey,
        code: item.code,
        label: item.label,
        base: item.base,
        percentage: item.percentage,
        amount: item.amount,
      })),
    })),
    totals: { withheld: snapshot.totals.withheld },
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

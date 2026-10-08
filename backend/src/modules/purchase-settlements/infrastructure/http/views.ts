// Vistas de las liquidaciones de compra (add-purchase-settlements, design D21): el borrador con su
// vista previa, los proveedores y la liquidación desde su snapshot, con sus declaraciones "declaradas
// por" el usuario y el aviso de la retención. Sin XML, respuestas originales ni datos técnicos.
import {
  PURCHASE_SETTLEMENT_STATEMENT_TEXTS,
  PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
  type PurchaseSettlementDraftSummaryView,
  type PurchaseSettlementDraftView,
  type PurchaseSettlementSummaryView,
  type PurchaseSettlementTransmissionView,
  type PurchaseSettlementView,
  type RateKind,
  type SriMessageView,
} from "@facturador/contracts";
import { roundHalfUp } from "../../../../platform/decimal/fiscal-decimal.ts";
import { documentBuyer } from "../../../fiscal/application/ports.ts";
import { stopMessage } from "../../../fiscal/application/transmission-messages.ts";
import {
  isAttemptCode,
  purchaseSettlementDiagnosticMessage,
} from "../../application/diagnostics.ts";
import type { PurchaseSettlementDraftDetails } from "../../application/drafts.ts";
import { toSupplierView } from "../../application/options.ts";
import type {
  PurchaseSettlementDetails,
  PurchaseSettlementListItem,
  PurchaseSettlementTransmission,
} from "../../application/purchase-settlements.ts";
import type { PurchaseSettlementSnapshot } from "../../domain/snapshot.ts";

export function toPurchaseSettlementDraftView({
  draft,
  context,
  preview,
}: PurchaseSettlementDraftDetails): PurchaseSettlementDraftView {
  const { point, supplier, products } = context;
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
    supplier: supplier ? toSupplierView(supplier) : null,
    supplierAddress: draft.supplierAddress,
    lines: draft.lines.map((line) => ({
      productId: line.productId,
      productName: line.productId ? (products.get(line.productId)?.name ?? null) : null,
      mainCode: line.mainCode,
      auxiliaryCode: line.auxiliaryCode,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      ivaRate: line.ivaRate,
    })),
    payments: draft.payments.map((payment) => ({
      paymentMethod: payment.paymentMethod,
      total: payment.total,
      term: payment.term,
      timeUnit: payment.timeUnit,
    })),
    preview,
    createdAt: draft.createdAt.toISOString(),
    createdBy: draft.createdBy,
    updatedAt: draft.updatedAt.toISOString(),
    updatedBy: draft.updatedBy,
  };
}

export function toPurchaseSettlementDraftSummaryView({
  draft,
  context,
  preview,
}: PurchaseSettlementDraftDetails): PurchaseSettlementDraftSummaryView {
  return {
    id: draft.id,
    version: draft.version,
    supplierName: context.supplier?.legalName ?? null,
    lineCount: draft.lines.length,
    previewTotal: preview.totals?.total ?? null,
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
}: PurchaseSettlementDetails): PurchaseSettlementView["diagnostic"] {
  const attempt = document.lastAttempt;
  if (document.state !== "RESERVED" || !attempt || !isAttemptCode(attempt.code)) return null;
  return {
    stage: attempt.stage as NonNullable<PurchaseSettlementView["diagnostic"]>["stage"],
    code: attempt.code,
    class: attempt.class,
    message: purchaseSettlementDiagnosticMessage(attempt.code, attempt.detail),
    at: attempt.at.toISOString(),
    attemptCount: document.attemptCount,
  };
}

function transmissionView({
  document,
  transmission,
}: PurchaseSettlementDetails): PurchaseSettlementView["transmission"] {
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
 * Liquidación desde su snapshot: lo que se emitió, sin releer el tercero, los productos, los
 * catálogos ni la configuración. Las declaraciones figuran como del usuario, con su autor y su
 * momento; el aviso de la retención no dice que la retención exista.
 */
export function toPurchaseSettlementView(
  details: PurchaseSettlementDetails,
): PurchaseSettlementView {
  const { document, artifact, authorizedArtifact } = details;
  const snapshot = document.snapshot as PurchaseSettlementSnapshot;
  const { issuer, supplier, eligibility } = snapshot;
  const rateKinds = new Map(snapshot.lines.map((line) => [line.tax.rateCode, line.tax]));
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
    supplier: {
      partyId: supplier.partyId,
      identificationType: supplier.identificationType,
      identification: supplier.identification,
      legalName: supplier.legalName,
      address: supplier.address,
    },
    eligibility: {
      case: eligibility.case,
      policy: eligibility.policy,
      rule: eligibility.rule,
      policyVersion: eligibility.policyVersion,
      declarations: eligibility.declarations.map((declaration) => ({
        statementId: declaration.statementId,
        text: PURCHASE_SETTLEMENT_STATEMENT_TEXTS[declaration.statementId],
        policyVersion: declaration.policyVersion,
        basis: "USER_DECLARED",
        declaredBy: declaration.declaredBy,
        declaredByName: declaration.declaredByName,
        declaredAt: declaration.declaredAt,
      })),
    },
    lines: snapshot.lines.map((line) => ({
      position: line.position,
      productId: line.productId,
      mainCode: line.mainCode,
      auxiliaryCode: line.auxiliaryCode,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      taxableBase: line.taxableBase,
      tax: {
        taxCode: "2",
        rateCode: line.tax.rateCode,
        rateKind: line.tax.rateKind as RateKind,
        percentage: line.tax.percentage,
        label: line.tax.label,
        base: line.tax.base,
        amount: line.tax.amount,
      },
    })),
    totals: {
      withoutTaxes: snapshot.totals.withoutTaxes,
      discount: snapshot.totals.discount,
      taxes: snapshot.totals.taxes.map((tax) => ({
        taxCode: "2",
        rateCode: tax.rateCode,
        rateKind: (rateKinds.get(tax.rateCode)?.rateKind ?? "PERCENTAGE") as RateKind,
        percentage: tax.percentage,
        label: rateKinds.get(tax.rateCode)?.label ?? tax.rateCode,
        base: tax.base,
        amount: tax.amount,
      })),
      total: snapshot.totals.total,
    },
    payments: snapshot.payments.map((payment) => ({
      position: payment.position,
      code: payment.code,
      label: payment.officialLabel,
      total: payment.total,
      term: payment.term,
      timeUnit: payment.timeUnit,
    })),
    currency: snapshot.currency,
    calculationVersion: snapshot.calculationVersion,
    withholdingNotice: PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
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

export function toPurchaseSettlementSummaryView({
  document,
  transmissionStopped,
}: PurchaseSettlementListItem): PurchaseSettlementSummaryView {
  const attempt = document.lastAttempt;
  const counterparty = documentBuyer(document);
  return {
    id: document.id,
    documentNumber: document.documentNumber,
    environment: document.environment,
    issueDate: document.issueDate,
    supplierIdentification: counterparty.identification,
    supplierName: counterparty.name,
    total: roundHalfUp(counterparty.total, 2),
    state: document.state,
    diagnosticCode:
      document.state === "RESERVED" && attempt && isAttemptCode(attempt.code) ? attempt.code : null,
    transmissionStopped,
    createdAt: document.createdAt.toISOString(),
  };
}

/** Historial de la transmisión: transiciones e intentos resumidos (design D18). */
export function toPurchaseSettlementTransmissionView({
  document,
  events,
  total,
}: PurchaseSettlementTransmission): PurchaseSettlementTransmissionView {
  return {
    purchaseSettlementId: document.id,
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

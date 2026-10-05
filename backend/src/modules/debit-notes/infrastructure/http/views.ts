// Vistas de las notas de débito (add-debit-notes, design D20): el borrador con su vista previa y las
// facturas elegibles. Sin XML, respuestas originales ni datos técnicos.
import type {
  DebitEligibleInvoiceView,
  DebitNoteDraftSummaryView,
  DebitNoteDraftView,
} from "@facturador/contracts";
import type { DebitNoteDraftDetails } from "../../application/drafts.ts";
import type { DebitEligibleInvoice } from "../../application/ports.ts";

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

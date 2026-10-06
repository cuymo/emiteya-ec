// Vistas de los comprobantes de retención (add-withholding-receipts, design D21): el borrador con su
// vista previa y los proveedores. Sin XML, respuestas originales ni datos técnicos.
import type {
  WithholdingDraftSummaryView,
  WithholdingDraftView,
  WithholdingSupplierView,
} from "@facturador/contracts";
import type { WithholdingDraftDetails } from "../../application/drafts.ts";
import type { WithheldSubject } from "../../domain/evaluation.ts";

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

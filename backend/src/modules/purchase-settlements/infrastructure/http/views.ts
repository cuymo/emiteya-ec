// Vistas de las liquidaciones de compra (add-purchase-settlements, design D21): el borrador con su
// vista previa y los proveedores. Sin XML, respuestas originales ni datos técnicos.
import type {
  PurchaseSettlementDraftSummaryView,
  PurchaseSettlementDraftView,
} from "@facturador/contracts";
import type { PurchaseSettlementDraftDetails } from "../../application/drafts.ts";
import { toSupplierView } from "../../application/options.ts";

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

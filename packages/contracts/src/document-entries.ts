// Lista unificada de cada tipo de comprobante (unify-drafts-into-document-lists, design D1 y D3):
// los borradores primero, el último editado arriba, y después los comprobantes emitidos, en una sola
// página. Cada entrada es `{ kind: "DRAFT", draft }` o `{ kind: "DOCUMENT", document }`, con las
// vistas de resumen que ya existen. El filtro de estado admite además `DRAFT`. Vive aparte para que
// ningún tipo importe a otro.
import { z } from "zod";
import {
  creditNoteDraftSummaryViewSchema,
  creditNoteSummaryViewSchema,
  listCreditNotesQuerySchema,
} from "./credit-notes.ts";
import {
  debitNoteDraftSummaryViewSchema,
  debitNoteSummaryViewSchema,
  listDebitNotesQuerySchema,
} from "./debit-notes.ts";
import {
  INVOICE_STATES,
  draftSummaryViewSchema,
  invoiceSummaryViewSchema,
  listInvoicesQuerySchema,
} from "./invoices.ts";
import { listMetaSchema } from "./pagination.ts";
import {
  listPurchaseSettlementsQuerySchema,
  purchaseSettlementDraftSummaryViewSchema,
  purchaseSettlementSummaryViewSchema,
} from "./purchase-settlements.ts";
import {
  listShippingGuidesQuerySchema,
  shippingGuideDraftSummaryViewSchema,
  shippingGuideSummaryViewSchema,
} from "./shipping-guides.ts";
import {
  listWithholdingReceiptsQuerySchema,
  withholdingDraftSummaryViewSchema,
  withholdingReceiptSummaryViewSchema,
} from "./withholding-receipts.ts";

/** El estado de filtro de los borradores, junto a los estados de un comprobante emitido. */
export const ENTRY_DRAFT_STATE = "DRAFT";
export const ENTRY_STATES = [...INVOICE_STATES, ENTRY_DRAFT_STATE] as const;
export const entryStateSchema = z.enum(ENTRY_STATES, { error: "El estado no es válido." });
export type EntryState = z.infer<typeof entryStateSchema>;

/** Una entrada de la lista: un borrador o un comprobante emitido. */
export type DocumentEntry<D, E> = { kind: "DRAFT"; draft: D } | { kind: "DOCUMENT"; document: E };

export function documentEntryViewSchema<D extends z.ZodType, E extends z.ZodType>(
  draft: D,
  document: E,
) {
  return z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("DRAFT"), draft }),
    z.strictObject({ kind: z.literal("DOCUMENT"), document }),
  ]);
}

export const documentEntryListMetaSchema = listMetaSchema;

const withDraftState = { state: entryStateSchema.optional() };

export const invoiceEntryViewSchema = documentEntryViewSchema(
  draftSummaryViewSchema,
  invoiceSummaryViewSchema,
);
export type InvoiceEntryView = z.infer<typeof invoiceEntryViewSchema>;
export const listInvoiceEntriesQuerySchema = listInvoicesQuerySchema.extend(withDraftState);
export type ListInvoiceEntriesQuery = z.output<typeof listInvoiceEntriesQuerySchema>;

export const creditNoteEntryViewSchema = documentEntryViewSchema(
  creditNoteDraftSummaryViewSchema,
  creditNoteSummaryViewSchema,
);
export type CreditNoteEntryView = z.infer<typeof creditNoteEntryViewSchema>;
export const listCreditNoteEntriesQuerySchema = listCreditNotesQuerySchema.extend(withDraftState);
export type ListCreditNoteEntriesQuery = z.output<typeof listCreditNoteEntriesQuerySchema>;

export const debitNoteEntryViewSchema = documentEntryViewSchema(
  debitNoteDraftSummaryViewSchema,
  debitNoteSummaryViewSchema,
);
export type DebitNoteEntryView = z.infer<typeof debitNoteEntryViewSchema>;
export const listDebitNoteEntriesQuerySchema = listDebitNotesQuerySchema.extend(withDraftState);
export type ListDebitNoteEntriesQuery = z.output<typeof listDebitNoteEntriesQuerySchema>;

export const purchaseSettlementEntryViewSchema = documentEntryViewSchema(
  purchaseSettlementDraftSummaryViewSchema,
  purchaseSettlementSummaryViewSchema,
);
export type PurchaseSettlementEntryView = z.infer<typeof purchaseSettlementEntryViewSchema>;
export const listPurchaseSettlementEntriesQuerySchema =
  listPurchaseSettlementsQuerySchema.extend(withDraftState);
export type ListPurchaseSettlementEntriesQuery = z.output<
  typeof listPurchaseSettlementEntriesQuerySchema
>;

export const withholdingReceiptEntryViewSchema = documentEntryViewSchema(
  withholdingDraftSummaryViewSchema,
  withholdingReceiptSummaryViewSchema,
);
export type WithholdingReceiptEntryView = z.infer<typeof withholdingReceiptEntryViewSchema>;
export const listWithholdingReceiptEntriesQuerySchema =
  listWithholdingReceiptsQuerySchema.extend(withDraftState);
export type ListWithholdingReceiptEntriesQuery = z.output<
  typeof listWithholdingReceiptEntriesQuerySchema
>;

export const shippingGuideEntryViewSchema = documentEntryViewSchema(
  shippingGuideDraftSummaryViewSchema,
  shippingGuideSummaryViewSchema,
);
export type ShippingGuideEntryView = z.infer<typeof shippingGuideEntryViewSchema>;
export const listShippingGuideEntriesQuerySchema =
  listShippingGuidesQuerySchema.extend(withDraftState);
export type ListShippingGuideEntriesQuery = z.output<typeof listShippingGuideEntriesQuerySchema>;

// Lo que cambia entre los comprobantes que el sistema emite en la bandeja y en las secciones
// compartidas del detalle (add-credit-notes, design D15; add-debit-notes, design D19;
// add-withholding-receipts, design D20; add-shipping-guides, design D21; add-purchase-settlements,
// design D20): el nombre con que se nombra al usuario, la ruta del detalle, la ruta de su API, su
// permiso de reconciliación, su clave de caché y el rótulo de su contraparte. Las reglas de
// disponibilidad de los documentos no cambian por tipo: las decide el servidor.
import {
  creditNoteTransmissionViewSchema,
  creditNoteViewSchema,
  debitNoteTransmissionViewSchema,
  debitNoteViewSchema,
  invoiceTransmissionViewSchema,
  invoiceViewSchema,
  purchaseSettlementTransmissionViewSchema,
  purchaseSettlementViewSchema,
  shippingGuideTransmissionViewSchema,
  shippingGuideViewSchema,
  withholdingReceiptViewSchema,
  withholdingTransmissionViewSchema,
  type DocumentType,
  type TransmissionEventView,
} from "@facturador/contracts";
import type { z } from "zod";
import type { Permission } from "@/lib/permissions";
import { CREDIT_NOTES_KEY } from "@/features/credit-notes/credit-notes-api";
import { DEBIT_NOTES_KEY } from "@/features/debit-notes/debit-notes-api";
import { INVOICES_KEY } from "@/features/invoices/invoices-api";
import { PURCHASE_SETTLEMENTS_KEY } from "@/features/purchase-settlements/purchase-settlements-api";
import { SHIPPING_GUIDES_KEY } from "@/features/shipping-guides/shipping-guides-api";
import { WITHHOLDINGS_KEY } from "@/features/withholding-receipts/withholding-receipts-api";

export type DocumentKind = Readonly<{
  /**
   * Sustantivo femenino en minúsculas: "factura", "liquidación", "nota de crédito", "nota de débito",
   * "guía", "retención".
   * Las secciones compartidas lo concuerdan en femenino ("la", "esta", "firmada", "autorizada").
   */
  noun: string;
  detailPath: string;
  apiPath: string;
  queryKey: readonly string[];
  reconcilePermission: Permission;
  notReconcilableCode: string;
  viewSchema: z.ZodType<{ documentNumber: string }>;
  transmissionSchema: z.ZodType<{ events: TransmissionEventView[]; total: number }>;
  /**
   * Cómo se rotula la contraparte en la bandeja cuando no es un comprador: "Proveedor" en la
   * liquidación de compra, que ocupa las columnas genéricas del comprador (design D20).
   */
  counterpartyLabel?: string;
}>;

/** Tipos que el sistema emite, en el orden del filtro de la bandeja. */
export const EMITTED_DOCUMENT_TYPES = ["01", "03", "04", "05", "06", "07"] as const;
export type EmittedDocumentType = (typeof EMITTED_DOCUMENT_TYPES)[number];

export const DOCUMENT_KINDS: Record<EmittedDocumentType, DocumentKind> = {
  "01": {
    noun: "factura",
    detailPath: "/facturas",
    apiPath: "/invoices",
    queryKey: INVOICES_KEY,
    reconcilePermission: "invoices.reconcile",
    notReconcilableCode: "INVOICE_NOT_RECONCILABLE",
    viewSchema: invoiceViewSchema,
    transmissionSchema: invoiceTransmissionViewSchema,
  },
  // "Liquidación" y no "liquidación de compra": las frases compartidas la nombran corta, en femenino.
  "03": {
    noun: "liquidación",
    detailPath: "/liquidaciones-compra",
    apiPath: "/purchase-settlements",
    queryKey: PURCHASE_SETTLEMENTS_KEY,
    reconcilePermission: "purchaseSettlements.reconcile",
    notReconcilableCode: "PURCHASE_SETTLEMENT_NOT_RECONCILABLE",
    viewSchema: purchaseSettlementViewSchema,
    transmissionSchema: purchaseSettlementTransmissionViewSchema,
    counterpartyLabel: "Proveedor",
  },
  "04": {
    noun: "nota de crédito",
    detailPath: "/notas-credito",
    apiPath: "/credit-notes",
    queryKey: CREDIT_NOTES_KEY,
    reconcilePermission: "creditNotes.reconcile",
    notReconcilableCode: "CREDIT_NOTE_NOT_RECONCILABLE",
    viewSchema: creditNoteViewSchema,
    transmissionSchema: creditNoteTransmissionViewSchema,
  },
  "05": {
    noun: "nota de débito",
    detailPath: "/notas-debito",
    apiPath: "/debit-notes",
    queryKey: DEBIT_NOTES_KEY,
    reconcilePermission: "debitNotes.reconcile",
    notReconcilableCode: "DEBIT_NOTE_NOT_RECONCILABLE",
    viewSchema: debitNoteViewSchema,
    transmissionSchema: debitNoteTransmissionViewSchema,
  },
  // "Guía" y no "guía de remisión": las frases compartidas la nombran corta, en femenino.
  "06": {
    noun: "guía",
    detailPath: "/guias-remision",
    apiPath: "/shipping-guides",
    queryKey: SHIPPING_GUIDES_KEY,
    reconcilePermission: "shippingGuides.reconcile",
    notReconcilableCode: "SHIPPING_GUIDE_NOT_RECONCILABLE",
    viewSchema: shippingGuideViewSchema,
    transmissionSchema: shippingGuideTransmissionViewSchema,
  },
  // "Retención" y no "comprobante de retención": las secciones compartidas concuerdan en femenino.
  "07": {
    noun: "retención",
    detailPath: "/retenciones",
    apiPath: "/withholding-receipts",
    queryKey: WITHHOLDINGS_KEY,
    reconcilePermission: "withholdings.reconcile",
    notReconcilableCode: "WITHHOLDING_NOT_RECONCILABLE",
    viewSchema: withholdingReceiptViewSchema,
    transmissionSchema: withholdingTransmissionViewSchema,
  },
};

/** El tipo de un comprobante que el sistema emite, o null para un tipo que todavía no emite. */
export function documentKind(type: DocumentType): DocumentKind | null {
  return (EMITTED_DOCUMENT_TYPES as readonly DocumentType[]).includes(type)
    ? DOCUMENT_KINDS[type as EmittedDocumentType]
    : null;
}

/** "La factura", "la nota de débito": con el artículo, para empezar o continuar una frase. */
export const withArticle = (kind: DocumentKind, start = false) =>
  `${start ? "La" : "la"} ${kind.noun}`;

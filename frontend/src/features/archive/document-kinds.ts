// Lo que cambia entre los comprobantes que el sistema emite en la bandeja y en las secciones
// compartidas del detalle (add-credit-notes, design D15): el nombre con que se nombra al usuario, la
// ruta del detalle, la ruta de su API, su permiso de reconciliación y su clave de caché. Las reglas
// de disponibilidad de los documentos no cambian por tipo: las decide el servidor.
import {
  creditNoteTransmissionViewSchema,
  creditNoteViewSchema,
  invoiceTransmissionViewSchema,
  invoiceViewSchema,
  type DocumentType,
  type TransmissionEventView,
} from "@facturador/contracts";
import type { z } from "zod";
import type { Permission } from "@/lib/permissions";
import { CREDIT_NOTES_KEY } from "@/features/credit-notes/credit-notes-api";
import { INVOICES_KEY } from "@/features/invoices/invoices-api";

export type DocumentKind = Readonly<{
  /** Sustantivo femenino en minúsculas: "factura", "nota de crédito". */
  noun: string;
  detailPath: string;
  apiPath: string;
  queryKey: readonly string[];
  reconcilePermission: Permission;
  notReconcilableCode: string;
  viewSchema: z.ZodType<{ documentNumber: string }>;
  transmissionSchema: z.ZodType<{ events: TransmissionEventView[]; total: number }>;
}>;

/** Tipos que el sistema emite, en el orden del filtro de la bandeja. */
export const EMITTED_DOCUMENT_TYPES = ["01", "04"] as const;
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
};

/** El tipo de un comprobante que el sistema emite, o null para un tipo que todavía no emite. */
export function documentKind(type: DocumentType): DocumentKind | null {
  return (EMITTED_DOCUMENT_TYPES as readonly DocumentType[]).includes(type)
    ? DOCUMENT_KINDS[type as EmittedDocumentType]
    : null;
}

/** "La factura", "la nota de crédito": con el artículo, para empezar o continuar una frase. */
export const withArticle = (kind: DocumentKind, start = false) =>
  `${start ? "La" : "la"} ${kind.noun}`;

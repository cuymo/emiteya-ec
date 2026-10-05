// Datos de Notas de crédito (add-credit-notes, design D16 y D19): la consulta y el detalle desde el
// snapshot, los borradores con la vista previa del servidor, la emisión con una Idempotency-Key
// estable por confirmación y las declaraciones del usuario, el reintento de la firma, el crédito de
// una factura y las facturas elegibles para el selector. Toda mutación pasa por useMutationFeedback.
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CREDIT_NOTE_ELIGIBILITY_DECLARATION,
  IDEMPOTENCY_KEY_HEADER,
  creditNoteDraftSummaryViewSchema,
  creditNoteDraftViewSchema,
  creditNoteListMetaSchema,
  creditNoteSummaryViewSchema,
  creditNoteViewSchema,
  eligibleInvoiceViewSchema,
  invoiceCreditViewSchema,
  type CreateCreditNoteDraftInput,
  type CreditNoteCause,
  type CreditNoteDeclarationStatement,
  type CreditNoteDraftView,
  type CreditNoteView,
  type EligibleInvoiceView,
  type InvoiceState,
  type UpdateCreditNoteDraftInput,
} from "@facturador/contracts";
import { z } from "zod";
import type { EntityPage, EntityPickerQuery } from "@/components/entity-picker-dialog";
import { useMutationFeedback, type SuccessFeedback } from "@/components/feedback";
import { apiFetch, apiFetchPage } from "@/lib/api";

export const CREDIT_NOTES_KEY = ["credit-notes"] as const;
export const CREDIT_NOTE_DRAFTS_KEY = ["credit-note-drafts"] as const;
/** El crédito de una factura cambia con cada nota: se invalida con las notas. */
const INVOICE_CREDIT_KEY = [...CREDIT_NOTES_KEY, "invoice-credit"] as const;

const draftPath = (id: string) => `/credit-notes/drafts/${encodeURIComponent(id)}`;
const notePath = (id: string) => `/credit-notes/${encodeURIComponent(id)}`;

/** Cada cuánto se refresca una nota con una interacción con el SRI en curso. */
const TRANSMISSION_REFRESH_MS = 5_000;

/** Mensajes de los conflictos que el usuario puede resolver, con lo que conviene hacer. */
export const CREDIT_NOTE_CONFLICT_MESSAGES: Record<string, string> = {
  CREDIT_NOTE_DRAFT_CHANGED:
    "Alguien cambió este borrador mientras lo revisabas. Recárgalo para ver la versión vigente.",
  CREDIT_NOTE_DRAFT_ALREADY_EMITTED:
    "Este borrador ya se emitió. Encuentra la nota en la lista de notas de crédito.",
  CREDIT_NOTE_QUANTITY_EXCEEDED:
    "Otra nota tomó parte de lo acreditable de la factura. Revisa las cantidades con la vista previa actualizada.",
  CREDIT_NOTE_AMOUNT_EXCEEDED:
    "Otra nota tomó parte del valor acreditable de la factura. Revisa la vista previa actualizada.",
  CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE:
    "La factura ya tiene créditos reservados o aplicados: la anulación total no procede. Usa una devolución.",
  CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED:
    "Otra nota devolvió parte de lo que la factura sacó del inventario. Revisa el retorno físico.",
  CREDIT_NOTE_DECLARATIONS_REQUIRED: "Confirma por separado las dos declaraciones para emitir.",
  IDEMPOTENCY_KEY_REUSED:
    "La solicitud de emisión ya se usó con otro contenido. Recarga el borrador y vuelve a emitir.",
};

export type CreditNotesQuery = {
  search: string;
  state: InvoiceState | undefined;
  cause: CreditNoteCause | undefined;
  page: number;
  pageSize: number;
};

export function useCreditNotes(query: CreditNotesQuery, enabled: boolean) {
  return useQuery({
    queryKey: [...CREDIT_NOTES_KEY, "list", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      if (query.search) params.set("search", query.search);
      if (query.state) params.set("state", query.state);
      if (query.cause) params.set("cause", query.cause);
      return apiFetchPage(`/credit-notes?${params.toString()}`, {
        schema: z.array(creditNoteSummaryViewSchema),
        meta: creditNoteListMetaSchema,
        signal,
      });
    },
  });
}

export function useCreditNote(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...CREDIT_NOTES_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) => apiFetch(notePath(id), { schema: creditNoteViewSchema, signal }),
    // Mientras el SRI procesa, el estado se actualiza solo.
    refetchInterval: (query) =>
      query.state.data?.transmission.inProgress ? TRANSMISSION_REFRESH_MS : false,
  });
}

export function useCreditNoteDrafts(query: { page: number; pageSize: number }, enabled: boolean) {
  return useQuery({
    queryKey: [...CREDIT_NOTE_DRAFTS_KEY, "list", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiFetchPage(`/credit-notes/drafts?page=${query.page}&pageSize=${query.pageSize}`, {
        schema: z.array(creditNoteDraftSummaryViewSchema),
        meta: creditNoteListMetaSchema,
        signal,
      }),
  });
}

export function useCreditNoteDraft(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...CREDIT_NOTE_DRAFTS_KEY, "detail", id],
    enabled: enabled && id !== null,
    queryFn: ({ signal }) =>
      apiFetch(draftPath(id!), { schema: creditNoteDraftViewSchema, signal }),
  });
}

/** Crédito de una factura: aplicado, reservado, disponible y por línea. */
export function useInvoiceCredit(invoiceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...INVOICE_CREDIT_KEY, invoiceId],
    enabled: enabled && invoiceId !== null,
    queryFn: ({ signal }) =>
      apiFetch(`/credit-notes/invoices/${encodeURIComponent(invoiceId!)}/credit`, {
        schema: invoiceCreditViewSchema,
        signal,
      }),
  });
}

export function useSaveCreditNoteDraft(options: {
  onSuccess: (draft: CreditNoteDraftView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({
      id,
      input,
    }: {
      id: string | null;
      input: CreateCreditNoteDraftInput | UpdateCreditNoteDraftInput;
    }) =>
      id
        ? apiFetch(draftPath(id), { method: "PUT", json: input, schema: creditNoteDraftViewSchema })
        : apiFetch("/credit-notes/drafts", {
            method: "POST",
            json: input,
            schema: creditNoteDraftViewSchema,
          }),
    success: () => "Guardaste el borrador.",
    invalidate: [CREDIT_NOTE_DRAFTS_KEY],
    errorMessages: CREDIT_NOTE_CONFLICT_MESSAGES,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useDeleteCreditNoteDraft(options: { onSuccess?: () => void } = {}) {
  return useMutationFeedback({
    mutationFn: (id: string) => apiFetch(draftPath(id), { method: "DELETE" }),
    success: () => "Eliminaste el borrador.",
    invalidate: [CREDIT_NOTE_DRAFTS_KEY],
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  });
}

/** Aviso de una nota tras emitirla o reintentar su firma. */
function noteFeedback(note: CreditNoteView, signedMessage: string): SuccessFeedback {
  if (note.state === "SIGNED") return signedMessage;
  return {
    tone: "warning",
    message: note.diagnostic
      ? `La nota de crédito ${note.documentNumber} quedó procesando: ${note.diagnostic.message}`
      : `La nota de crédito ${note.documentNumber} quedó procesando.`,
  };
}

/**
 * Emitir: la Idempotency-Key la genera la confirmación y se repite en los reintentos; las
 * declaraciones viajan con su versión y son parte de la misma solicitud (design D9 y D11).
 */
export function useEmitCreditNote(options: {
  onSuccess: (note: CreditNoteView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({
      draft,
      statements,
      idempotencyKey,
    }: {
      draft: { id: string; version: number };
      statements: readonly CreditNoteDeclarationStatement[];
      idempotencyKey: string;
    }) =>
      apiFetch("/credit-notes", {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        json: {
          draftId: draft.id,
          expectedVersion: draft.version,
          declarations: { version: CREDIT_NOTE_ELIGIBILITY_DECLARATION.version, statements },
        },
        schema: creditNoteViewSchema,
      }),
    success: (note) => noteFeedback(note, `Emitiste la nota de crédito ${note.documentNumber}.`),
    invalidate: [[...CREDIT_NOTE_DRAFTS_KEY, "list"], CREDIT_NOTES_KEY],
    errorMessages: CREDIT_NOTE_CONFLICT_MESSAGES,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useRetryCreditNoteSigning() {
  return useMutationFeedback({
    mutationFn: (id: string) =>
      apiFetch(`${notePath(id)}/signing-attempts`, {
        method: "POST",
        schema: creditNoteViewSchema,
      }),
    success: (note) => noteFeedback(note, `Firmaste la nota de crédito ${note.documentNumber}.`),
    invalidate: [CREDIT_NOTES_KEY],
  });
}

/** Facturas autorizadas, sin consumidor final y con capacidad, por número o comprador. */
export async function fetchEligibleInvoices({
  search,
  page,
  pageSize,
  signal,
}: EntityPickerQuery): Promise<EntityPage<EligibleInvoiceView>> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  const { data, meta } = await apiFetchPage(
    `/credit-notes/eligible-invoices?${params.toString()}`,
    { schema: z.array(eligibleInvoiceViewSchema), meta: creditNoteListMetaSchema, signal },
  );
  return { items: data, total: meta.total };
}

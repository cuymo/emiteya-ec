// Datos de Notas de débito (add-debit-notes, design D20 y D23): la consulta y el detalle desde el
// snapshot, los borradores con la vista previa del servidor, la emisión con una Idempotency-Key
// estable por confirmación y la declaración del usuario, el reintento de la firma y las facturas
// elegibles para el selector. Toda mutación pasa por useMutationFeedback.
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  DEBIT_NOTE_ELIGIBILITY_DECLARATION,
  IDEMPOTENCY_KEY_HEADER,
  debitEligibleInvoiceViewSchema,
  debitNoteDraftSummaryViewSchema,
  debitNoteDraftViewSchema,
  debitNoteListMetaSchema,
  debitNoteSummaryViewSchema,
  debitNoteViewSchema,
  type CreateDebitNoteDraftInput,
  type DebitEligibleInvoiceView,
  type DebitNoteCause,
  type DebitNoteDeclarationStatement,
  type DebitNoteDraftView,
  type DebitNoteView,
  type InvoiceState,
  type UpdateDebitNoteDraftInput,
} from "@facturador/contracts";
import { z } from "zod";
import type { EntityPage, EntityPickerQuery } from "@/components/entity-picker-dialog";
import { useMutationFeedback, type SuccessFeedback } from "@/components/feedback";
import { apiFetch, apiFetchPage } from "@/lib/api";

export const DEBIT_NOTES_KEY = ["debit-notes"] as const;
export const DEBIT_NOTE_DRAFTS_KEY = ["debit-note-drafts"] as const;

const draftPath = (id: string) => `/debit-notes/drafts/${encodeURIComponent(id)}`;
const notePath = (id: string) => `/debit-notes/${encodeURIComponent(id)}`;

/** Cada cuánto se refresca una nota con una interacción con el SRI en curso. */
const TRANSMISSION_REFRESH_MS = 5_000;

/** Mensajes de los conflictos que el usuario puede resolver, con lo que conviene hacer. */
export const DEBIT_NOTE_CONFLICT_MESSAGES: Record<string, string> = {
  DEBIT_NOTE_DRAFT_CHANGED:
    "Alguien cambió este borrador mientras lo revisabas. Recárgalo para ver la versión vigente.",
  DEBIT_NOTE_DRAFT_ALREADY_EMITTED:
    "Este borrador ya se emitió. Encuentra la nota en la lista de notas de débito.",
  DEBIT_NOTE_INVOICE_NOT_ELIGIBLE:
    "La factura ya no admite una nota de débito: debe estar autorizada y ser del ambiente vigente.",
  DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE:
    "Un concepto usa un tratamiento de IVA que la factura no tiene. Elige uno de los de la factura.",
  DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE:
    "La forma de pago ya no está vigente o habilitada. Elige otra con la vista previa actualizada.",
  DEBIT_NOTE_PAYMENT_TOTAL_MISMATCH:
    "El total de la forma de pago no coincide con el valor total de la nota. Recarga el borrador.",
  DEBIT_NOTE_DECLARATION_REQUIRED: "Confirma la declaración para emitir.",
  IDEMPOTENCY_KEY_REUSED:
    "La solicitud de emisión ya se usó con otro contenido. Recarga el borrador y vuelve a emitir.",
};

export type DebitNotesQuery = {
  search: string;
  state: InvoiceState | undefined;
  cause: DebitNoteCause | undefined;
  page: number;
  pageSize: number;
};

export function useDebitNotes(query: DebitNotesQuery, enabled: boolean) {
  return useQuery({
    queryKey: [...DEBIT_NOTES_KEY, "list", query],
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
      return apiFetchPage(`/debit-notes?${params.toString()}`, {
        schema: z.array(debitNoteSummaryViewSchema),
        meta: debitNoteListMetaSchema,
        signal,
      });
    },
  });
}

export function useDebitNote(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...DEBIT_NOTES_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) => apiFetch(notePath(id), { schema: debitNoteViewSchema, signal }),
    // Mientras el SRI procesa, el estado se actualiza solo.
    refetchInterval: (query) =>
      query.state.data?.transmission.inProgress ? TRANSMISSION_REFRESH_MS : false,
  });
}

export function useDebitNoteDrafts(query: { page: number; pageSize: number }, enabled: boolean) {
  return useQuery({
    queryKey: [...DEBIT_NOTE_DRAFTS_KEY, "list", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiFetchPage(`/debit-notes/drafts?page=${query.page}&pageSize=${query.pageSize}`, {
        schema: z.array(debitNoteDraftSummaryViewSchema),
        meta: debitNoteListMetaSchema,
        signal,
      }),
  });
}

export function useDebitNoteDraft(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...DEBIT_NOTE_DRAFTS_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) => apiFetch(draftPath(id), { schema: debitNoteDraftViewSchema, signal }),
  });
}

export function useSaveDebitNoteDraft(options: {
  onSuccess: (draft: DebitNoteDraftView) => void;
  onError: (error: unknown) => boolean;
  /** Crear el borrador al elegir la factura no es "guardar": tiene su propio aviso. */
  success?: string;
}) {
  return useMutationFeedback({
    mutationFn: ({
      id,
      input,
    }: {
      id: string | null;
      input: CreateDebitNoteDraftInput | UpdateDebitNoteDraftInput;
    }) =>
      id
        ? apiFetch(draftPath(id), { method: "PUT", json: input, schema: debitNoteDraftViewSchema })
        : apiFetch("/debit-notes/drafts", {
            method: "POST",
            json: input,
            schema: debitNoteDraftViewSchema,
          }),
    success: () => options.success ?? "Guardaste el borrador.",
    invalidate: [DEBIT_NOTE_DRAFTS_KEY],
    errorMessages: DEBIT_NOTE_CONFLICT_MESSAGES,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useDeleteDebitNoteDraft(options: { onSuccess?: () => void } = {}) {
  return useMutationFeedback({
    mutationFn: (id: string) => apiFetch(draftPath(id), { method: "DELETE" }),
    success: () => "Eliminaste el borrador.",
    invalidate: [DEBIT_NOTE_DRAFTS_KEY],
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  });
}

/** Aviso de una nota tras emitirla o reintentar su firma. */
function noteFeedback(note: DebitNoteView, signedMessage: string): SuccessFeedback {
  if (note.state === "SIGNED") return signedMessage;
  return {
    tone: "warning",
    message: note.diagnostic
      ? `La nota de débito ${note.documentNumber} quedó procesando: ${note.diagnostic.message}`
      : `La nota de débito ${note.documentNumber} quedó procesando.`,
  };
}

/**
 * Emitir: la Idempotency-Key la genera la confirmación y se repite en los reintentos; la declaración
 * viaja con su versión y es parte de la misma solicitud (design D9 y D15).
 */
export function useEmitDebitNote(options: {
  onSuccess: (note: DebitNoteView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({
      draft,
      statements,
      idempotencyKey,
    }: {
      draft: { id: string; version: number };
      statements: readonly DebitNoteDeclarationStatement[];
      idempotencyKey: string;
    }) =>
      apiFetch("/debit-notes", {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        json: {
          draftId: draft.id,
          expectedVersion: draft.version,
          declarations: { version: DEBIT_NOTE_ELIGIBILITY_DECLARATION.version, statements },
        },
        schema: debitNoteViewSchema,
      }),
    success: (note) => noteFeedback(note, `Emitiste la nota de débito ${note.documentNumber}.`),
    invalidate: [[...DEBIT_NOTE_DRAFTS_KEY, "list"], DEBIT_NOTES_KEY],
    errorMessages: DEBIT_NOTE_CONFLICT_MESSAGES,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useRetryDebitNoteSigning() {
  return useMutationFeedback({
    mutationFn: (id: string) =>
      apiFetch(`${notePath(id)}/signing-attempts`, {
        method: "POST",
        schema: debitNoteViewSchema,
      }),
    success: (note) => noteFeedback(note, `Firmaste la nota de débito ${note.documentNumber}.`),
    invalidate: [DEBIT_NOTES_KEY],
  });
}

/** Facturas autorizadas, sin consumidor final y del ambiente vigente, por número o comprador. */
export async function fetchDebitEligibleInvoices({
  search,
  page,
  pageSize,
  signal,
}: EntityPickerQuery): Promise<EntityPage<DebitEligibleInvoiceView>> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  const { data, meta } = await apiFetchPage(`/debit-notes/eligible-invoices?${params.toString()}`, {
    schema: z.array(debitEligibleInvoiceViewSchema),
    meta: debitNoteListMetaSchema,
    signal,
  });
  return { items: data, total: meta.total };
}

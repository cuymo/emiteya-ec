// Datos de Borradores y Facturas (add-invoice-emission, design D13 y D15; add-sri-transmission,
// design D18 y D20): borradores con su vista previa del servidor, también la de un contenido sin
// guardar mientras se edita, emisión con una Idempotency-Key
// estable por solicitud, facturas desde su snapshot y reintento de la firma. La transmisión y su
// reconciliación, compartidas con la nota de crédito, viven en la bandeja (`archive-api`). Toda
// mutación pasa por useMutationFeedback.
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  IDEMPOTENCY_KEY_HEADER,
  draftListMetaSchema,
  draftPreviewViewSchema,
  draftSummaryViewSchema,
  draftViewSchema,
  invoiceListMetaSchema,
  invoiceSummaryViewSchema,
  invoiceViewSchema,
  partyListMetaSchema,
  partyViewSchema,
  productListMetaSchema,
  productViewSchema,
  type CreateDraftInput,
  type DraftView,
  type InvoiceState,
  type InvoiceView,
  type PartyView,
  type ProductView,
  type UpdateDraftInput,
} from "@facturador/contracts";
import { z } from "zod";
import type { EntityPage, EntityPickerQuery } from "@/components/entity-picker-dialog";
import { useMutationFeedback, type SuccessFeedback } from "@/components/feedback";
import { apiFetch, apiFetchPage } from "@/lib/api";

export const DRAFTS_KEY = ["invoice-drafts"] as const;
export const INVOICES_KEY = ["invoices"] as const;

const draftPath = (id: string) => `/invoices/drafts/${encodeURIComponent(id)}`;
const invoicePath = (id: string) => `/invoices/${encodeURIComponent(id)}`;

export function useDrafts(query: { page: number; pageSize: number }, enabled: boolean) {
  return useQuery({
    queryKey: [...DRAFTS_KEY, "list", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiFetchPage(`/invoices/drafts?page=${query.page}&pageSize=${query.pageSize}`, {
        schema: z.array(draftSummaryViewSchema),
        meta: draftListMetaSchema,
        signal,
      }),
  });
}

/** Un borrador, leído de nuevo: para recargarlo tras un conflicto de versión. */
export const fetchDraft = (id: string) => apiFetch(draftPath(id), { schema: draftViewSchema });

export function useDraft(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...DRAFTS_KEY, "detail", id],
    enabled: enabled && id !== null,
    queryFn: ({ signal }) => apiFetch(draftPath(id!), { schema: draftViewSchema, signal }),
  });
}

/**
 * Vista previa del servidor de un contenido sin guardar: los totales, los impuestos y los problemas
 * mientras se edita, con el cálculo de la emisión. `null` mientras el contenido no es válido. La
 * anterior se conserva mientras llega la nueva, para que el resumen no parpadee.
 */
export function useDraftPreview(input: CreateDraftInput | null) {
  return useQuery({
    queryKey: [...DRAFTS_KEY, "preview", input],
    enabled: input !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      apiFetch("/invoices/drafts/preview", {
        method: "POST",
        json: input,
        schema: draftPreviewViewSchema,
        signal,
      }),
  });
}

/** Guarda un borrador nuevo o corrige uno existente; la usan el guardado y la emisión. */
export const saveDraftRequest = (id: string | null, input: CreateDraftInput | UpdateDraftInput) =>
  id
    ? apiFetch(draftPath(id), { method: "PUT", json: input, schema: draftViewSchema })
    : apiFetch("/invoices/drafts", { method: "POST", json: input, schema: draftViewSchema });

export function useSaveDraft(options: {
  onSuccess: (draft: DraftView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({
      id,
      input,
    }: {
      id: string | null;
      input: CreateDraftInput | UpdateDraftInput;
    }) => saveDraftRequest(id, input),
    success: () => "Guardaste el borrador.",
    invalidate: [DRAFTS_KEY],
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useDeleteDraft(options: { onSuccess?: () => void } = {}) {
  return useMutationFeedback({
    mutationFn: (id: string) => apiFetch(draftPath(id), { method: "DELETE" }),
    success: () => "Eliminaste el borrador.",
    invalidate: [DRAFTS_KEY],
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  });
}

/** Aviso de una factura tras emitirla o reintentar su firma. */
function invoiceFeedback(invoice: InvoiceView, signedMessage: string): SuccessFeedback {
  if (invoice.state === "SIGNED") return signedMessage;
  return {
    tone: "warning",
    message: invoice.diagnostic
      ? `La factura ${invoice.documentNumber} quedó procesando: ${invoice.diagnostic.message}`
      : `La factura ${invoice.documentNumber} quedó procesando.`,
  };
}

/** Emitir: la Idempotency-Key la genera la confirmación y se repite en los reintentos (design D8). */
export function useEmitInvoice(options: {
  onSuccess: (invoice: InvoiceView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({
      draft,
      idempotencyKey,
    }: {
      draft: { id: string; version: number };
      idempotencyKey: string;
    }) =>
      apiFetch("/invoices", {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        json: { draftId: draft.id, expectedVersion: draft.version },
        schema: invoiceViewSchema,
      }),
    success: (invoice) =>
      invoiceFeedback(invoice, `Emitiste la factura ${invoice.documentNumber}.`),
    // Solo la lista: el detalle del borrador emitido ya no existe como borrador, y el editor que lo
    // muestra navega a la factura.
    invalidate: [[...DRAFTS_KEY, "list"], INVOICES_KEY],
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export type InvoicesQuery = {
  search: string;
  state: InvoiceState | undefined;
  /** "Requiere atención": resultado incierto, revisión manual o transmisión detenida. */
  attention?: boolean;
  page: number;
  pageSize: number;
};

export function useInvoices(query: InvoicesQuery, enabled: boolean) {
  return useQuery({
    queryKey: [...INVOICES_KEY, "list", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
      });
      if (query.search) params.set("search", query.search);
      if (query.state) params.set("state", query.state);
      if (query.attention) params.set("attention", "true");
      return apiFetchPage(`/invoices?${params.toString()}`, {
        schema: z.array(invoiceSummaryViewSchema),
        meta: invoiceListMetaSchema,
        signal,
      });
    },
  });
}

/**
 * Cuántas facturas de la empresa requieren atención (productize-invoice-list-and-shared-table-
 * foundation, design D7, PO-2): `attention=true&pageSize=1` y su `meta.total`. La clave no lleva la
 * página, las filas, el estado ni la búsqueda, así que cambiarlos no la repite; se renueva con la
 * invalidación de las facturas, como la lista.
 */
export function useInvoiceAttentionCount(enabled: boolean) {
  return useQuery({
    queryKey: [...INVOICES_KEY, "attention-count"],
    enabled,
    queryFn: async ({ signal }) => {
      const page = await apiFetchPage("/invoices?attention=true&pageSize=1", {
        schema: z.array(invoiceSummaryViewSchema),
        meta: invoiceListMetaSchema,
        signal,
      });
      return page.meta.total;
    },
  });
}

/** Cada cuánto se refresca una factura con una interacción con el SRI en curso. */
export const TRANSMISSION_REFRESH_MS = 5_000;

export function useInvoice(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...INVOICES_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) => apiFetch(invoicePath(id), { schema: invoiceViewSchema, signal }),
    // Mientras el SRI procesa, el estado se actualiza solo (design D20).
    refetchInterval: (query) =>
      query.state.data?.transmission.inProgress ? TRANSMISSION_REFRESH_MS : false,
  });
}

export function useRetrySigning() {
  return useMutationFeedback({
    mutationFn: (id: string) =>
      apiFetch(`${invoicePath(id)}/signing-attempts`, {
        method: "POST",
        schema: invoiceViewSchema,
      }),
    success: (invoice) =>
      invoiceFeedback(invoice, `Firmaste la factura ${invoice.documentNumber}.`),
    invalidate: [INVOICES_KEY],
  });
}

/**
 * Compradores para el selector: terceros activos con rol de cliente. El consumidor final del sistema
 * no se repite entre los resultados: el selector lo ofrece como opción rápida.
 */
export async function fetchCustomers({
  search,
  page,
  pageSize,
  signal,
}: EntityPickerQuery): Promise<EntityPage<PartyView>> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    status: "ACTIVE",
    role: "CUSTOMER",
  });
  if (search) params.set("search", search);
  const { data, meta } = await apiFetchPage(`/parties?${params.toString()}`, {
    schema: z.array(partyViewSchema),
    meta: partyListMetaSchema,
    signal,
  });
  const items = data.filter((party) => party.systemRecord !== "CONSUMER_FINAL");
  return { items, total: meta.total - (data.length - items.length) };
}

/** El consumidor final de la empresa, el registro del sistema con la identidad de la política. */
export async function fetchConsumerFinal(): Promise<PartyView | null> {
  const { data } = await apiFetchPage("/parties?search=9999999999999&status=ACTIVE&pageSize=10", {
    schema: z.array(partyViewSchema),
    meta: partyListMetaSchema,
  });
  return data.find((party) => party.systemRecord === "CONSUMER_FINAL") ?? null;
}

/** Productos activos para el selector, por código o nombre. */
export async function fetchProducts({
  search,
  page,
  pageSize,
  signal,
}: EntityPickerQuery): Promise<EntityPage<ProductView>> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    status: "ACTIVE",
  });
  if (search) params.set("search", search);
  const { data, meta } = await apiFetchPage(`/products?${params.toString()}`, {
    schema: z.array(productViewSchema),
    meta: productListMetaSchema,
    signal,
  });
  return { items: data, total: meta.total };
}

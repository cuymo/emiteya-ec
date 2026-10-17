// Datos de Guías de remisión (add-shipping-guides, design D21, D22 y D25): la consulta y el detalle
// desde el snapshot, los borradores con la vista previa del servidor, las opciones, los
// transportistas, los destinatarios, las facturas elegibles y sus mercancías sugeridas, la emisión
// con una Idempotency-Key estable por confirmación y el reintento de la firma. Toda mutación pasa por
// useMutationFeedback.
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  IDEMPOTENCY_KEY_HEADER,
  shippingCarrierViewSchema,
  shippingEligibleInvoiceViewSchema,
  shippingGuideDraftViewSchema,
  shippingGuideEntryViewSchema,
  shippingGuideListMetaSchema,
  shippingGuideOptionsViewSchema,
  shippingGuideViewSchema,
  shippingInvoiceGoodsViewSchema,
  shippingRecipientPartyViewSchema,
  type CreateShippingGuideDraftInput,
  type EntryState,
  type InvoiceState,
  productListMetaSchema,
  productViewSchema,
  type ProductView,
  type ShippingCarrierView,
  type ShippingEligibleInvoiceView,
  type ShippingGuideDraftView,
  type ShippingGuideView,
  type ShippingRecipientPartyView,
  type UpdateShippingGuideDraftInput,
} from "@facturador/contracts";
import { z } from "zod";
import type { EntityPage, EntityPickerQuery } from "@/components/entity-picker-dialog";
import { useMutationFeedback, type SuccessFeedback } from "@/components/feedback";
import { apiFetch, apiFetchPage } from "@/lib/api";
import { useDocumentEntries } from "@/features/documents/use-document-entries";

export const SHIPPING_GUIDES_KEY = ["shipping-guides"] as const;
export const SHIPPING_GUIDE_DRAFTS_KEY = ["shipping-guide-drafts"] as const;
/** La lista unificada cuelga de las guías y se renueva también con cada cambio de un borrador. */
export const SHIPPING_GUIDE_ENTRIES_KEY = [...SHIPPING_GUIDES_KEY, "entries"] as const;
export const SHIPPING_GUIDE_OPTIONS_KEY = ["shipping-guide-options"] as const;

const draftPath = (id: string) => `/shipping-guides/drafts/${encodeURIComponent(id)}`;
const guidePath = (id: string) => `/shipping-guides/${encodeURIComponent(id)}`;

/** Cada cuánto se refresca una guía con una interacción con el SRI en curso. */
const TRANSMISSION_REFRESH_MS = 5_000;

/** Mensajes de los conflictos que el usuario puede resolver, con lo que conviene hacer. */
export const SHIPPING_GUIDE_CONFLICT_MESSAGES: Record<string, string> = {
  SHIPPING_GUIDE_DRAFT_CHANGED:
    "Alguien cambió este borrador mientras lo revisabas. Recárgalo para ver la versión vigente.",
  SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED:
    "Este borrador ya se emitió. Encuentra la guía en la lista de guías de remisión.",
  SHIPPING_GUIDE_RESOURCE_LIMIT:
    "El borrador supera un límite de recursos del sistema (no es una regla del SRI). Quita destinatarios o detalles.",
  SHIPPING_GUIDE_START_BEFORE_ISSUE:
    "La fecha de inicio del transporte es anterior a la de emisión, que es la de hoy. Corrige la fecha de inicio.",
  SHIPPING_GUIDE_CARRIER_ROLE_REQUIRED:
    "El tercero no tiene el rol de transportista. Agrégaselo en Terceros o elige otro transportista.",
  SHIPPING_GUIDE_DECLARATION_REQUIRED:
    "Confirma la declaración de los traslados sin factura antes de emitir.",
  SHIPPING_GUIDE_DECLARATION_VERSION_MISMATCH:
    "La política de excepciones cambió. Recarga el borrador y confirma la declaración otra vez.",
  SHIPPING_GUIDE_DECLARATION_NOT_APPLICABLE:
    "La guía ya no declara excepciones. Recarga el borrador y vuelve a emitir.",
  SHIPPING_GUIDE_INVOICE_NOT_AUTHORIZED:
    "Una factura sustento ya no está autorizada. Elige otra factura o declara la excepción que corresponda.",
  IDEMPOTENCY_KEY_REUSED:
    "La solicitud de emisión ya se usó con otro contenido. Recarga el borrador y vuelve a emitir.",
};

export type ShippingGuidesQuery = {
  search: string;
  state: InvoiceState | undefined;
  page: number;
  pageSize: number;
};

/** La lista de Guías de remisión: borradores primero y después las guías emitidas (D1 y D5). */
export function useShippingGuideEntries(
  query: Omit<ShippingGuidesQuery, "state"> & { state: EntryState | undefined },
  enabled: boolean,
) {
  return useDocumentEntries({
    key: SHIPPING_GUIDE_ENTRIES_KEY,
    path: "/shipping-guides/entries",
    params: {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      state: query.state,
    },
    entry: shippingGuideEntryViewSchema,
    enabled,
  });
}

export function useShippingGuide(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...SHIPPING_GUIDES_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) => apiFetch(guidePath(id), { schema: shippingGuideViewSchema, signal }),
    // Mientras el SRI procesa, el estado se actualiza solo.
    refetchInterval: (query) =>
      query.state.data?.transmission.inProgress ? TRANSMISSION_REFRESH_MS : false,
  });
}

export function useShippingGuideDraft(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...SHIPPING_GUIDE_DRAFTS_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(draftPath(id), { schema: shippingGuideDraftViewSchema, signal }),
  });
}

/** Política de excepciones, establecimientos activos, identidad del transporte propio y límites. */
export function useShippingGuideOptions(enabled: boolean) {
  return useQuery({
    queryKey: SHIPPING_GUIDE_OPTIONS_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/shipping-guides/options", { schema: shippingGuideOptionsViewSchema, signal }),
  });
}

/** Las líneas de una factura como sugerencia no autoritativa; se piden al abrir el diálogo. */
export function useInvoiceGoods(invoiceId: string | null) {
  return useQuery({
    queryKey: [...SHIPPING_GUIDE_OPTIONS_KEY, "goods", invoiceId],
    enabled: invoiceId !== null,
    queryFn: ({ signal }) =>
      apiFetch(`/shipping-guides/eligible-invoices/${encodeURIComponent(invoiceId!)}/goods`, {
        schema: shippingInvoiceGoodsViewSchema,
        signal,
      }),
  });
}

export function useSaveShippingGuideDraft(options: {
  onSuccess: (draft: ShippingGuideDraftView) => void;
  onError: (error: unknown) => boolean;
  /** Crear el borrador desde una factura no es "guardar": tiene su propio aviso. */
  success?: string;
}) {
  return useMutationFeedback({
    mutationFn: ({
      id,
      input,
    }: {
      id: string | null;
      input: CreateShippingGuideDraftInput | UpdateShippingGuideDraftInput;
    }) =>
      id
        ? apiFetch(draftPath(id), {
            method: "PUT",
            json: input,
            schema: shippingGuideDraftViewSchema,
          })
        : apiFetch("/shipping-guides/drafts", {
            method: "POST",
            json: input,
            schema: shippingGuideDraftViewSchema,
          }),
    success: () => options.success ?? "Guardaste el borrador.",
    invalidate: [SHIPPING_GUIDE_DRAFTS_KEY, SHIPPING_GUIDE_ENTRIES_KEY],
    errorMessages: SHIPPING_GUIDE_CONFLICT_MESSAGES,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useDeleteShippingGuideDraft(options: { onSuccess?: () => void } = {}) {
  return useMutationFeedback({
    mutationFn: (id: string) => apiFetch(draftPath(id), { method: "DELETE" }),
    success: () => "Eliminaste el borrador.",
    invalidate: [SHIPPING_GUIDE_DRAFTS_KEY, SHIPPING_GUIDE_ENTRIES_KEY],
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  });
}

/** Aviso de una guía tras emitirla o reintentar su firma. */
function guideFeedback(guide: ShippingGuideView, signedMessage: string): SuccessFeedback {
  if (guide.state === "SIGNED") return signedMessage;
  return {
    tone: "warning",
    message: guide.diagnostic
      ? `La guía ${guide.documentNumber} quedó procesando: ${guide.diagnostic.message}`
      : `La guía ${guide.documentNumber} quedó procesando.`,
  };
}

/**
 * Emitir: la Idempotency-Key la genera la confirmación y se repite en los reintentos de la misma
 * versión (design D15); la declaración confirmada viaja con su versión de la política.
 */
export function useEmitShippingGuide(options: {
  onSuccess: (guide: ShippingGuideView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({
      draft,
      idempotencyKey,
      declarationPolicyVersion,
    }: {
      draft: { id: string; version: number };
      idempotencyKey: string;
      declarationPolicyVersion: number | null;
    }) =>
      apiFetch("/shipping-guides", {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        json: {
          draftId: draft.id,
          expectedVersion: draft.version,
          exceptionDeclaration:
            declarationPolicyVersion === null ? null : { policyVersion: declarationPolicyVersion },
        },
        schema: shippingGuideViewSchema,
      }),
    success: (guide) => guideFeedback(guide, `Emitiste la guía ${guide.documentNumber}.`),
    invalidate: [[...SHIPPING_GUIDE_DRAFTS_KEY, "list"], SHIPPING_GUIDES_KEY],
    errorMessages: SHIPPING_GUIDE_CONFLICT_MESSAGES,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useRetryShippingGuideSigning() {
  return useMutationFeedback({
    mutationFn: (id: string) =>
      apiFetch(`${guidePath(id)}/signing-attempts`, {
        method: "POST",
        schema: shippingGuideViewSchema,
      }),
    success: (guide) => guideFeedback(guide, `Firmaste la guía ${guide.documentNumber}.`),
    invalidate: [SHIPPING_GUIDES_KEY],
  });
}

const lookup = async <T>(
  path: string,
  schema: z.ZodType<T>,
  { search, page, pageSize, signal }: EntityPickerQuery,
): Promise<EntityPage<T>> => {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  const { data, meta } = await apiFetchPage(`${path}?${params.toString()}`, {
    schema: z.array(schema),
    meta: shippingGuideListMetaSchema,
    signal,
  });
  return { items: data, total: meta.total };
};

/** Transportistas: activos con el rol, con los no seleccionables y su motivo. */
export const fetchShippingCarriers = (query: EntityPickerQuery) =>
  lookup<ShippingCarrierView>("/shipping-guides/carriers", shippingCarrierViewSchema, query);

/** Destinatarios: terceros activos con RUC, cédula o pasaporte y cualquier rol. */
export const fetchShippingRecipients = (query: EntityPickerQuery) =>
  lookup<ShippingRecipientPartyView>(
    "/shipping-guides/recipients",
    shippingRecipientPartyViewSchema,
    query,
  );

/** Facturas autorizadas del ambiente vigente que pueden sustentar una guía. */
export const fetchShippingEligibleInvoices = (query: EntityPickerQuery) =>
  lookup<ShippingEligibleInvoiceView>(
    "/shipping-guides/eligible-invoices",
    shippingEligibleInvoiceViewSchema,
    query,
  );

/** Bienes activos para el detalle: un servicio no se traslada (design D9). */
export async function fetchShippingGoods({
  search,
  page,
  pageSize,
  signal,
}: EntityPickerQuery): Promise<EntityPage<ProductView>> {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    status: "ACTIVE",
    kind: "GOOD",
  });
  if (search) params.set("search", search);
  const { data, meta } = await apiFetchPage(`/products?${params.toString()}`, {
    schema: z.array(productViewSchema),
    meta: productListMetaSchema,
    signal,
  });
  return { items: data, total: meta.total };
}

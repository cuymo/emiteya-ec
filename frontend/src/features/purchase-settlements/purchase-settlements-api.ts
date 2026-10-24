// Datos de Liquidaciones de compra (add-purchase-settlements, design D20, D21 y D24): la consulta y
// el detalle desde el snapshot, los borradores con la vista previa del servidor, las opciones, los
// proveedores, los productos como sugerencia, la emisión con las cuatro declaraciones y una
// Idempotency-Key estable por confirmación, y el reintento de la firma. Toda mutación pasa por
// useMutationFeedback.
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  IDEMPOTENCY_KEY_HEADER,
  productListMetaSchema,
  productViewSchema,
  purchaseSettlementDraftViewSchema,
  purchaseSettlementEntryViewSchema,
  purchaseSettlementListMetaSchema,
  purchaseSettlementOptionsViewSchema,
  purchaseSettlementSupplierViewSchema,
  purchaseSettlementViewSchema,
  type CreatePurchaseSettlementDraftInput,
  type EntryState,
  type InvoiceState,
  type ProductView,
  type PurchaseSettlementDraftView,
  type PurchaseSettlementStatement,
  type PurchaseSettlementSupplierView,
  type PurchaseSettlementView,
  type UpdatePurchaseSettlementDraftInput,
} from "@facturador/contracts";
import { z } from "zod";
import type { EntityPage, EntityPickerQuery } from "@/components/entity-picker-dialog";
import { useMutationFeedback, type SuccessFeedback } from "@/components/feedback";
import { apiFetch, apiFetchPage } from "@/lib/api";
import { useDocumentEntries } from "@/features/documents/use-document-entries";

export const PURCHASE_SETTLEMENTS_KEY = ["purchase-settlements"] as const;
export const PURCHASE_SETTLEMENT_DRAFTS_KEY = ["purchase-settlement-drafts"] as const;
/** La lista unificada cuelga de las liquidaciones y se renueva también con cada cambio de un borrador. */
export const PURCHASE_SETTLEMENT_ENTRIES_KEY = [...PURCHASE_SETTLEMENTS_KEY, "entries"] as const;
export const PURCHASE_SETTLEMENT_OPTIONS_KEY = ["purchase-settlement-options"] as const;

const draftPath = (id: string) => `/purchase-settlements/drafts/${encodeURIComponent(id)}`;
const settlementPath = (id: string) => `/purchase-settlements/${encodeURIComponent(id)}`;

/** Cada cuánto se refresca una liquidación con una interacción con el SRI en curso. */
const TRANSMISSION_REFRESH_MS = 5_000;

/** Mensajes de los conflictos que el usuario puede resolver, con lo que conviene hacer. */
export const PURCHASE_SETTLEMENT_CONFLICT_MESSAGES: Record<string, string> = {
  PURCHASE_SETTLEMENT_DRAFT_CHANGED:
    "Alguien cambió este borrador mientras lo revisabas. Recárgalo para ver la versión vigente.",
  PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED:
    "Este borrador ya se emitió. Encuentra la liquidación en la lista de liquidaciones de compra.",
  PURCHASE_SETTLEMENT_RESOURCE_LIMIT:
    "El borrador supera un límite de recursos del sistema (no es una regla del SRI). Quita líneas o pagos.",
  PURCHASE_SETTLEMENT_SUPPLIER_ROLE_REQUIRED:
    "El tercero no tiene el rol de proveedor. Agrégaselo en Clientes y proveedores o elige otro proveedor.",
  PURCHASE_SETTLEMENT_DECLARATION_REQUIRED:
    "Confirma las cuatro declaraciones de procedencia antes de emitir.",
  PURCHASE_SETTLEMENT_DECLARATION_VERSION_MISMATCH:
    "La política de procedencia cambió. Recarga el borrador y confirma las declaraciones otra vez.",
  IDEMPOTENCY_KEY_REUSED:
    "La solicitud de emisión ya se usó con otro contenido. Recarga el borrador y vuelve a emitir.",
};

export type PurchaseSettlementsQuery = {
  search: string;
  state: InvoiceState | undefined;
  page: number;
  pageSize: number;
};

/** La lista de Liquidaciones de compra: borradores primero y después las emitidas (D1 y D5). */
export function usePurchaseSettlementEntries(
  query: Omit<PurchaseSettlementsQuery, "state"> & { state: EntryState | undefined },
  enabled: boolean,
) {
  return useDocumentEntries({
    key: PURCHASE_SETTLEMENT_ENTRIES_KEY,
    path: "/purchase-settlements/entries",
    params: {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      state: query.state,
    },
    entry: purchaseSettlementEntryViewSchema,
    enabled,
  });
}

export function usePurchaseSettlement(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...PURCHASE_SETTLEMENTS_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(settlementPath(id), { schema: purchaseSettlementViewSchema, signal }),
    // Mientras el SRI procesa, el estado se actualiza solo.
    refetchInterval: (query) =>
      query.state.data?.transmission.inProgress ? TRANSMISSION_REFRESH_MS : false,
  });
}

export function usePurchaseSettlementDraft(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...PURCHASE_SETTLEMENT_DRAFTS_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(draftPath(id), { schema: purchaseSettlementDraftViewSchema, signal }),
  });
}

/**
 * La política de procedencia con sus declaraciones, el aviso de la retención, la moneda, las tarifas
 * de IVA y las formas de pago utilizables, y los límites efectivos.
 */
export function usePurchaseSettlementOptions(enabled: boolean) {
  return useQuery({
    queryKey: PURCHASE_SETTLEMENT_OPTIONS_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/purchase-settlements/options", {
        schema: purchaseSettlementOptionsViewSchema,
        signal,
      }),
  });
}

export function useSavePurchaseSettlementDraft(options: {
  onSuccess: (draft: PurchaseSettlementDraftView) => void;
  onError: (error: unknown) => boolean;
  /** Crear el borrador no es "guardar": tiene su propio aviso. */
  success?: string;
}) {
  return useMutationFeedback({
    mutationFn: ({
      id,
      input,
    }: {
      id: string | null;
      input: CreatePurchaseSettlementDraftInput | UpdatePurchaseSettlementDraftInput;
    }) =>
      id
        ? apiFetch(draftPath(id), {
            method: "PUT",
            json: input,
            schema: purchaseSettlementDraftViewSchema,
          })
        : apiFetch("/purchase-settlements/drafts", {
            method: "POST",
            json: input,
            schema: purchaseSettlementDraftViewSchema,
          }),
    success: () => options.success ?? "Guardaste el borrador.",
    invalidate: [PURCHASE_SETTLEMENT_DRAFTS_KEY, PURCHASE_SETTLEMENT_ENTRIES_KEY],
    errorMessages: PURCHASE_SETTLEMENT_CONFLICT_MESSAGES,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useDeletePurchaseSettlementDraft(options: { onSuccess?: () => void } = {}) {
  return useMutationFeedback({
    mutationFn: (id: string) => apiFetch(draftPath(id), { method: "DELETE" }),
    success: () => "Eliminaste el borrador.",
    invalidate: [PURCHASE_SETTLEMENT_DRAFTS_KEY, PURCHASE_SETTLEMENT_ENTRIES_KEY],
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  });
}

/** Aviso de una liquidación tras emitirla o reintentar su firma. */
function settlementFeedback(
  settlement: PurchaseSettlementView,
  signedMessage: string,
): SuccessFeedback {
  if (settlement.state === "SIGNED") return signedMessage;
  return {
    tone: "warning",
    message: settlement.diagnostic
      ? `La liquidación ${settlement.documentNumber} quedó procesando: ${settlement.diagnostic.message}`
      : `La liquidación ${settlement.documentNumber} quedó procesando.`,
  };
}

/**
 * Emitir: la Idempotency-Key la genera la confirmación y se repite en los reintentos de la misma
 * versión (design D14); las cuatro declaraciones viajan con la versión de la política.
 */
export function useEmitPurchaseSettlement(options: {
  onSuccess: (settlement: PurchaseSettlementView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({
      draft,
      idempotencyKey,
      policyVersion,
      statements,
    }: {
      draft: { id: string; version: number };
      idempotencyKey: string;
      policyVersion: number;
      statements: readonly PurchaseSettlementStatement[];
    }) =>
      apiFetch("/purchase-settlements", {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        json: {
          draftId: draft.id,
          expectedVersion: draft.version,
          declarations: { policyVersion, statements: [...statements] },
        },
        schema: purchaseSettlementViewSchema,
      }),
    success: (settlement) =>
      settlementFeedback(settlement, `Emitiste la liquidación ${settlement.documentNumber}.`),
    invalidate: [[...PURCHASE_SETTLEMENT_DRAFTS_KEY, "list"], PURCHASE_SETTLEMENTS_KEY],
    errorMessages: PURCHASE_SETTLEMENT_CONFLICT_MESSAGES,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useRetryPurchaseSettlementSigning() {
  return useMutationFeedback({
    mutationFn: (id: string) =>
      apiFetch(`${settlementPath(id)}/signing-attempts`, {
        method: "POST",
        schema: purchaseSettlementViewSchema,
      }),
    success: (settlement) =>
      settlementFeedback(settlement, `Firmaste la liquidación ${settlement.documentNumber}.`),
    invalidate: [PURCHASE_SETTLEMENTS_KEY],
  });
}

/** Proveedores: activos con el rol, con los no seleccionables y su motivo (design D4). */
export async function fetchPurchaseSuppliers({
  search,
  page,
  pageSize,
  signal,
}: EntityPickerQuery): Promise<EntityPage<PurchaseSettlementSupplierView>> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) params.set("search", search);
  const { data, meta } = await apiFetchPage(
    `/purchase-settlements/suppliers?${params.toString()}`,
    {
      schema: z.array(purchaseSettlementSupplierViewSchema),
      meta: purchaseSettlementListMetaSchema,
      signal,
    },
  );
  return { items: data, total: meta.total };
}

/** Productos activos, bienes o servicios: solo sugieren el código y el nombre (design D6). */
export async function fetchPurchaseProducts({
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

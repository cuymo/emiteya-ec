// Datos del inventario (add-minimal-inventory, design D8, D10 y D13): la lista con sus filtros, el
// detalle de un producto, su kárdex y las operaciones que registran movimientos. Las entradas y los
// ajustes llevan la Idempotency-Key que genera el diálogo al abrirse y que se repite en los
// reintentos. Las acciones pasan por useMutationFeedback.
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  IDEMPOTENCY_KEY_HEADER,
  stockItemDetailViewSchema,
  stockItemListMetaSchema,
  stockItemViewSchema,
  stockMovementListMetaSchema,
  stockMovementViewSchema,
  type InitializeStockInput,
  type StockAdjustmentInput,
  type StockEntryInput,
  type StockItemDetailView,
  type StockListFilter,
  type StockMovementView,
} from "@facturador/contracts";
import { z } from "zod";
import { useMutationFeedback } from "@/components/feedback";
import { apiFetch, apiFetchPage } from "@/lib/api";
import { formatDecimal } from "@/lib/decimal";
import { PRODUCTS_KEY } from "@/features/products/products-api";

export const INVENTORY_KEY = ["inventory"] as const;

const itemPath = (productId: string) => `/inventory/items/${encodeURIComponent(productId)}`;

export type StockItemsQuery = {
  search: string;
  state: StockListFilter | undefined;
  page: number;
  pageSize: number;
};

export function useStockItems(query: StockItemsQuery, enabled: boolean) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.search) params.set("search", query.search);
  if (query.state) params.set("state", query.state);
  return useQuery({
    queryKey: [...INVENTORY_KEY, "list", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiFetchPage(`/inventory/items?${params.toString()}`, {
        schema: z.array(stockItemViewSchema),
        meta: stockItemListMetaSchema,
        signal,
      }),
  });
}

export function useStockItem(productId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...INVENTORY_KEY, "item", productId],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(itemPath(productId), { schema: stockItemDetailViewSchema, signal }),
  });
}

export type StockMovementsQuery = { from: string; to: string; page: number; pageSize: number };

export function useStockMovements(productId: string, query: StockMovementsQuery, enabled: boolean) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return useQuery({
    queryKey: [...INVENTORY_KEY, "movements", productId, query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiFetchPage(`${itemPath(productId)}/movements?${params.toString()}`, {
        schema: z.array(stockMovementViewSchema),
        meta: stockMovementListMetaSchema,
        signal,
      }),
  });
}

type MutationOptions = { onSuccess?: () => void; onError?: (error: unknown) => boolean };

const callbacks = (options: MutationOptions) => ({
  ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  ...(options.onError ? { onError: options.onError } : {}),
});

export function useInitializeStock(options: MutationOptions = {}) {
  return useMutationFeedback({
    mutationFn: ({ productId, input }: { productId: string; input: InitializeStockInput }) =>
      apiFetch(`${itemPath(productId)}/initialization`, {
        method: "POST",
        json: input,
        schema: stockItemDetailViewSchema,
      }),
    success: (item: StockItemDetailView) =>
      `Inicializaste el inventario de ${item.name} con ${formatDecimal(item.balance ?? "0")}.`,
    invalidate: [INVENTORY_KEY],
    ...callbacks(options),
  });
}

export function useRecordEntry(options: MutationOptions = {}) {
  return useMutationFeedback({
    mutationFn: ({
      productId,
      idempotencyKey,
      input,
    }: {
      productId: string;
      idempotencyKey: string;
      input: StockEntryInput;
    }) =>
      apiFetch(`${itemPath(productId)}/entries`, {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        json: input,
        schema: stockMovementViewSchema,
      }),
    success: (movement: StockMovementView) =>
      `Registraste la entrada de ${formatDecimal(movement.delta)}. Saldo: ${formatDecimal(movement.balanceAfter)}.`,
    invalidate: [INVENTORY_KEY],
    ...callbacks(options),
  });
}

export function useRecordAdjustment(options: MutationOptions = {}) {
  return useMutationFeedback({
    mutationFn: ({
      productId,
      idempotencyKey,
      input,
    }: {
      productId: string;
      idempotencyKey: string;
      input: StockAdjustmentInput;
    }) =>
      apiFetch(`${itemPath(productId)}/adjustments`, {
        method: "POST",
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
        json: input,
        schema: stockMovementViewSchema,
      }),
    success: (movement: StockMovementView) =>
      `Registraste el ajuste de ${formatDecimal(movement.delta)}. Saldo: ${formatDecimal(movement.balanceAfter)}.`,
    invalidate: [INVENTORY_KEY],
    ...callbacks(options),
  });
}

/** Activar o desactivar el control también cambia la marca del producto. */
export function useSetStockTracking(options: MutationOptions = {}) {
  return useMutationFeedback({
    mutationFn: ({ productId, tracked }: { productId: string; tracked: boolean }) =>
      apiFetch(`${itemPath(productId)}/tracking`, {
        method: "PUT",
        json: { tracked },
        schema: stockItemDetailViewSchema,
      }),
    success: (_item, { tracked }) =>
      tracked ? "Activaste el control de stock." : "Desactivaste el control de stock.",
    invalidate: [INVENTORY_KEY, PRODUCTS_KEY],
    ...callbacks(options),
  });
}

// Datos de la pantalla Productos (add-parties-and-products, design D8, D11 y D17): lista paginada
// en el servidor con el estado tributario, recuentos para los filtros y para Catálogos fiscales,
// opciones de impuestos utilizables del catálogo fiscal y mutaciones con useMutationFeedback.
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  catalogEntriesViewSchema,
  productListMetaSchema,
  productTaxSummaryViewSchema,
  productViewSchema,
  type CreateProductInput,
  type ProductKind,
  type ProductTaxCatalogType,
  type ProductView,
  type RecordStatus,
  type TaxConfigurationStatus,
  type UpdateProductInput,
} from "@facturador/contracts";
import { z } from "zod";
import { useMutationFeedback, type SuccessFeedback } from "@/components/feedback";
import { apiFetch, apiFetchPage } from "@/lib/api";
import { formatPercentage } from "@/lib/decimal";
import { sentence } from "@/features/parties/parties-api";

export const PRODUCTS_KEY = ["products"] as const;

export type ProductsQuery = {
  search: string;
  status: RecordStatus | "ALL";
  kind: ProductKind | undefined;
  taxStatus: TaxConfigurationStatus | undefined;
  page: number;
  pageSize: number;
};

export function useProducts(query: ProductsQuery, enabled: boolean) {
  return useQuery({
    queryKey: [...PRODUCTS_KEY, "list", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
        status: query.status,
      });
      if (query.search) params.set("search", query.search);
      if (query.kind) params.set("kind", query.kind);
      if (query.taxStatus) params.set("taxStatus", query.taxStatus);
      return apiFetchPage(`/products?${params.toString()}`, {
        schema: z.array(productViewSchema),
        meta: productListMetaSchema,
        signal,
      });
    },
  });
}

/** Un producto, para corregirlo en su página. */
export function useProduct(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...PRODUCTS_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`/products/${encodeURIComponent(id)}`, { schema: productViewSchema, signal }),
  });
}

/** Recuentos de productos activos por estado tributario y por entrada (design D8). */
export function useProductTaxSummary(enabled: boolean) {
  return useQuery({
    queryKey: [...PRODUCTS_KEY, "tax-summary"],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/products/tax-summary", { schema: productTaxSummaryViewSchema, signal }),
  });
}

export type TaxOption = { entryKey: string; label: string };

/** Etiqueta de una entrada: denominación, código, variante si la hay y tarifa si existe. */
function optionLabel(entry: z.infer<typeof catalogEntriesViewSchema>["entries"][number]) {
  const version = entry.applicable ?? entry.versions.at(-1)!;
  const parts = [version.officialLabel, `código ${entry.code}`];
  if (entry.entryKey !== entry.code) parts.push(`variante ${entry.entryKey}`);
  if (version.rate?.percentage) parts.push(formatPercentage(version.rate.percentage));
  return parts.join(" · ");
}

/** Entradas utilizables hoy de un catálogo de impuestos, para el formulario. */
export function useTaxOptions(catalogType: ProductTaxCatalogType, enabled: boolean) {
  return useQuery({
    queryKey: ["fiscal-catalogs", "entries", catalogType, "options"],
    enabled,
    queryFn: async ({ signal }) => {
      const view = await apiFetch(`/fiscal-catalogs/${catalogType}/entries`, {
        schema: catalogEntriesViewSchema,
        signal,
      });
      return view.entries
        .filter((entry) => entry.usable)
        .map((entry): TaxOption => ({ entryKey: entry.entryKey, label: optionLabel(entry) }));
    },
  });
}

const sendProduct = (method: "POST" | "PUT", path: string, json: unknown) =>
  apiFetch(path, { method, json, schema: productViewSchema });

export function useSaveProduct(options: {
  onSuccess: (product: ProductView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({ id, input }: { id?: string; input: CreateProductInput | UpdateProductInput }) =>
      id
        ? sendProduct("PUT", `/products/${encodeURIComponent(id)}`, input)
        : sendProduct("POST", "/products", input),
    success: (product, { id }) =>
      sentence(id ? `Guardaste los cambios de ${product.name}` : `Registraste ${product.name}`),
    invalidate: [PRODUCTS_KEY],
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

/** Desactivar es reversible: un paso, con Deshacer en el aviso. */
export function useChangeProductStatus() {
  const mutation = useMutationFeedback({
    mutationFn: ({ product, status }: { product: ProductView; status: RecordStatus }) =>
      sendProduct("PUT", `/products/${encodeURIComponent(product.id)}/status`, { status }),
    success: (product): SuccessFeedback =>
      product.status === "INACTIVE"
        ? {
            message: sentence(`Desactivaste ${product.name}`),
            action: {
              label: "Deshacer",
              onClick: () => mutation.mutate({ product, status: "ACTIVE" }),
            },
          }
        : sentence(`Reactivaste ${product.name}`),
    invalidate: [PRODUCTS_KEY],
  });
  return mutation;
}

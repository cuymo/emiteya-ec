// Datos de la pantalla Catálogos fiscales (add-fiscal-catalogs, design D11 y D17). La habilitación
// pasa por useMutationFeedback e invalida las listas de entradas y los datos de productos, cuyo
// estado tributario deriva de la habilitación.
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  catalogEntriesViewSchema,
  catalogEntryViewSchema,
  consumerFinalPolicyViewSchema,
  fiscalCatalogSummaryViewSchema,
  schemaRegistryEntryViewSchema,
  specialCaseViewSchema,
  type CatalogEntryVersionView,
  type CatalogEntryView,
  type FiscalCatalogType,
} from "@facturador/contracts";
import { z } from "zod";
import { useMutationFeedback } from "@/components/feedback";
import { apiFetch } from "@/lib/api";

export const FISCAL_CATALOGS_KEY = ["fiscal-catalogs"] as const;

const DATE = new Intl.DateTimeFormat("es-EC", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
/** Fecha ISO de un catálogo (sin hora) en el formato de Ecuador. */
export const formatIsoDate = (iso: string) => DATE.format(new Date(`${iso}T00:00:00Z`));

/**
 * Origen de la fecha de inicio (design D3): declarada por la fuente, o base del proyecto, que es la
 * publicación de la ficha y nunca se presenta como fecha legal de vigencia.
 */
export function startDescription(version: CatalogEntryVersionView, sourceVersion: string): string {
  return version.effectiveFromBasis === "SOURCE_STATED"
    ? `Desde ${formatIsoDate(version.effectiveFrom)} (declarada por la fuente)`
    : `Base del proyecto: ficha v${sourceVersion} (${formatIsoDate(version.effectiveFrom)})`;
}

export const CATALOG_NOUNS: Record<FiscalCatalogType, string> = {
  "identification-type": "el tipo de identificación",
  tax: "el impuesto",
  "iva-rate": "la tarifa de IVA",
  "ice-rate": "el código de ICE",
  "irbpnr-rate": "el código de IRBPNR",
  "payment-method": "la forma de pago",
};

export function useCatalogSummaries(enabled: boolean) {
  return useQuery({
    queryKey: [...FISCAL_CATALOGS_KEY, "summary"],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/fiscal-catalogs", { schema: z.array(fiscalCatalogSummaryViewSchema), signal }),
  });
}

export function useCatalogEntries(catalogType: FiscalCatalogType, enabled: boolean) {
  return useQuery({
    queryKey: [...FISCAL_CATALOGS_KEY, "entries", catalogType],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`/fiscal-catalogs/${catalogType}/entries`, {
        schema: catalogEntriesViewSchema,
        signal,
      }),
  });
}

export function useConsumerFinalPolicy(enabled: boolean) {
  return useQuery({
    queryKey: [...FISCAL_CATALOGS_KEY, "consumer-final-policy"],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/fiscal-catalogs/consumer-final-policy", {
        schema: consumerFinalPolicyViewSchema,
        signal,
      }),
  });
}

export function useSchemaRegistry(enabled: boolean) {
  return useQuery({
    queryKey: [...FISCAL_CATALOGS_KEY, "schemas"],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/fiscal-catalogs/schemas", {
        schema: z.array(schemaRegistryEntryViewSchema),
        signal,
      }),
  });
}

export function useSpecialCases(enabled: boolean) {
  return useQuery({
    queryKey: [...FISCAL_CATALOGS_KEY, "special-cases"],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/fiscal-catalogs/special-cases", {
        schema: z.array(specialCaseViewSchema),
        signal,
      }),
  });
}

export const entryLabel = (entry: CatalogEntryView) =>
  (entry.applicable ?? entry.versions.at(-1))?.officialLabel ?? entry.code;

export function useSetEnablement() {
  return useMutationFeedback({
    mutationFn: ({
      catalogType,
      entry,
      enabled,
    }: {
      catalogType: FiscalCatalogType;
      entry: CatalogEntryView;
      enabled: boolean;
    }) =>
      apiFetch(
        `/fiscal-catalogs/${catalogType}/entries/${encodeURIComponent(entry.entryKey)}/enablement`,
        { method: "PUT", json: { enabled }, schema: catalogEntryViewSchema },
      ),
    success: (updated, { catalogType }) =>
      `${updated.enablement.enabled ? "Habilitaste" : "Deshabilitaste"} ${CATALOG_NOUNS[catalogType]} ${entryLabel(updated)} para tu empresa.`,
    // El estado tributario de los productos que usan la entrada también cambia (add-parties-and-products).
    invalidate: [[...FISCAL_CATALOGS_KEY, "entries"], ["products"]],
  });
}

// Datos de Portabilidad de datos (add-data-portability, design D16, D17 y D23): la historia de las
// exportaciones de la empresa, consultada cada 2 s mientras una está en cola o generándose, la
// solicitud de una nueva y la ruta de descarga, que el navegador sigue como enlace: el paquete nunca
// pasa por la memoria de la página.
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  PAGE_SIZE_MAX,
  dataExportListMetaSchema,
  dataExportViewSchema,
  type DataExportView,
} from "@facturador/contracts";
import { z } from "zod";
import { useMutationFeedback } from "@/components/feedback";
import { API_BASE_PATH, apiFetch, apiFetchPage } from "@/lib/api";

export const DATA_EXPORTS_KEY = ["data-exports"] as const;
export const DATA_EXPORTS_REFRESH_MS = 2_000;
const READY_REFRESH_MS = 60_000;

export const isActive = (row: DataExportView) =>
  row.status === "QUEUED" || row.status === "GENERATING";

const page = (query: { page: number; pageSize: number }, signal: AbortSignal) =>
  apiFetchPage(`/data-exports?page=${query.page}&pageSize=${query.pageSize}`, {
    schema: z.array(dataExportViewSchema),
    meta: dataExportListMetaSchema,
    signal,
  });

/**
 * Lo vigente de la empresa: la generación activa, que siempre es la más reciente, y el paquete
 * listo, que es el más reciente de los listos. Se consulta cada 2 s mientras hay una activa.
 */
export function useCurrentExports(enabled: boolean) {
  return useQuery({
    queryKey: [...DATA_EXPORTS_KEY, "current"],
    enabled,
    queryFn: async ({ signal }) => {
      const { data } = await page({ page: 1, pageSize: PAGE_SIZE_MAX }, signal);
      const latest = data[0] ?? null;
      return {
        latest,
        active: latest && isActive(latest) ? latest : null,
        ready: data.find((row) => row.status === "READY") ?? null,
      };
    },
    // Con un paquete listo, cada minuto: su caducidad se refleja sin recargar.
    refetchInterval: (query) =>
      query.state.data?.active
        ? DATA_EXPORTS_REFRESH_MS
        : query.state.data?.ready
          ? READY_REFRESH_MS
          : false,
  });
}

/**
 * La historia paginada. `current` resume lo vigente (la última exportación y su estado): cuando
 * cambia, la historia se consulta de nuevo aunque ya no haya una generación activa.
 */
export function useExportHistory(
  query: { page: number; pageSize: number },
  options: { enabled: boolean; polling: boolean; current: string },
) {
  return useQuery({
    queryKey: [...DATA_EXPORTS_KEY, "history", query, options.current],
    enabled: options.enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => page(query, signal),
    refetchInterval: options.polling ? DATA_EXPORTS_REFRESH_MS : false,
  });
}

export function useRequestExport(options: { onError: (error: unknown) => boolean }) {
  return useMutationFeedback({
    mutationFn: () =>
      apiFetch("/data-exports", { method: "POST", json: {}, schema: dataExportViewSchema }),
    success: () => "Solicitaste la exportación. Puedes salir de esta pantalla mientras se genera.",
    invalidate: [DATA_EXPORTS_KEY],
    onError: options.onError,
  });
}

/** La ruta autenticada del paquete, del mismo origen: el navegador la descarga por streaming. */
export const downloadHref = (id: string) =>
  `${API_BASE_PATH}/data-exports/${encodeURIComponent(id)}/download`;

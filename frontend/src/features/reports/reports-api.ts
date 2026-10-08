// Datos de Reportes (add-reports-export, design D12 y D16): la página de cada reporte con sus
// filtros, y la exportación a XLSX con los mismos filtros, que descarga el archivo. Los rechazos de
// la exportación (`409` y `503`) los explica la pantalla junto al botón.
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  REPORT_CONTRACTS,
  reportListMetaSchema,
  type ReportId,
  type ReportListMeta,
} from "@facturador/contracts";
import { z } from "zod";
import { useMutationFeedback } from "@/components/feedback";
import { apiFetchFile, apiFetchPage } from "@/lib/api";

export const REPORTS_KEY = ["reports"] as const;

/** Una página de un reporte: sus filas, en la forma de su contrato, y su total. */
export type ReportPage = { data: Record<string, unknown>[]; meta: ReportListMeta };

/** Filtros del reporte como los recibe la API; los vacíos no se envían. */
export type ReportFilters = Readonly<Record<string, string | undefined>>;

const queryString = (filters: ReportFilters, page?: { page: number; pageSize: number }) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (page) {
    params.set("page", String(page.page));
    params.set("pageSize", String(page.pageSize));
  }
  return params.toString();
};

export function useReport(
  report: ReportId,
  filters: ReportFilters,
  page: { page: number; pageSize: number },
  enabled: boolean,
) {
  return useQuery<ReportPage>({
    queryKey: [...REPORTS_KEY, report, filters, page],
    enabled,
    // Las filas anteriores solo se conservan dentro del mismo reporte (otra página u otros filtros):
    // las de otro reporte tienen otra forma y sus columnas no las sabrían leer.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === report ? previous : undefined,
    queryFn: ({ signal }) =>
      apiFetchPage(`/reports/${report}?${queryString(filters, page)}`, {
        schema: z.array(REPORT_CONTRACTS[report].row as z.ZodType<Record<string, unknown>>),
        meta: reportListMetaSchema,
        signal,
      }) as Promise<ReportPage>,
  });
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function useExportReport(options: { onError: (error: unknown) => boolean }) {
  return useMutationFeedback({
    mutationFn: async ({ report, filters }: { report: ReportId; filters: ReportFilters }) => {
      const { blob, filename } = await apiFetchFile(
        `/reports/${report}/export?${queryString(filters)}`,
      );
      save(blob, filename ?? `${report}.xlsx`);
    },
    success: () => "Descargaste el XLSX.",
    onError: options.onError,
  });
}

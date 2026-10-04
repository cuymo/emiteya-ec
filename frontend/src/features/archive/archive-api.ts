// Datos de la bandeja y de los documentos de un comprobante (add-document-archive, design D8 y
// D13): la bandeja con sus filtros, el resumen de documentos (que se refresca mientras el RIDE se
// prepara), el historial de entregas, las descargas, la impresión y el reintento. Las acciones que
// dejan rastro pasan por useMutationFeedback.
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  documentDeliveriesViewSchema,
  documentListItemSchema,
  documentListMetaSchema,
  documentSummaryViewSchema,
  printRequestViewSchema,
  type DocumentState,
  type DocumentSummaryView,
} from "@facturador/contracts";
import { z } from "zod";
import { useMutationFeedback } from "@/components/feedback";
import { apiFetch, apiFetchFile, apiFetchPage } from "@/lib/api";

export const DOCUMENTS_KEY = ["documents"] as const;

const documentPath = (id: string) => `/documents/${encodeURIComponent(id)}`;

export type DocumentsQuery = {
  search: string;
  state: DocumentState | undefined;
  from: string;
  to: string;
  identification: string;
  establishmentId: string;
  emissionPointId: string;
  page: number;
  pageSize: number;
};

export function useDocuments(query: DocumentsQuery, enabled: boolean) {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  for (const key of [
    "search",
    "from",
    "to",
    "identification",
    "establishmentId",
    "emissionPointId",
  ] as const) {
    if (query[key]) params.set(key, query[key]);
  }
  if (query.state) params.set("state", query.state);
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, "list", query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiFetchPage(`/documents?${params.toString()}`, {
        schema: z.array(documentListItemSchema),
        meta: documentListMetaSchema,
        signal,
      }),
  });
}

/** Resumen de los documentos; mientras el RIDE se prepara, se vuelve a pedir cada 5 s. */
export function useDocumentSummary(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, "summary", id],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(documentPath(id), { schema: documentSummaryViewSchema, signal }),
    refetchInterval: (query) =>
      (query.state.data as DocumentSummaryView | undefined)?.documents.ride === "PENDING"
        ? 5_000
        : false,
  });
}

export function useDocumentDeliveries(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...DOCUMENTS_KEY, "deliveries", id],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`${documentPath(id)}/deliveries`, { schema: documentDeliveriesViewSchema, signal }),
  });
}

export type DownloadKind = "ride" | "authorized-xml" | "signed-xml";

const DOWNLOAD_NAMES: Record<DownloadKind, string> = {
  ride: "el RIDE",
  "authorized-xml": "el XML autorizado",
  "signed-xml": "el XML firmado",
};

const ERROR_MESSAGES = {
  ARTIFACT_INTEGRITY_FAILED:
    "El documento guardado no pasó la verificación de integridad y no se descargó. Avisa al administrador.",
};

/** Guarda un archivo con el nombre que propone el servidor. */
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

/** Abre los bytes del RIDE en un iframe oculto y llama al diálogo de impresión del navegador. */
function printPdf(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.title = "RIDE para imprimir";
  frame.className = "sr-only";
  frame.src = url;
  const cleanup = () => {
    frame.remove();
    URL.revokeObjectURL(url);
  };
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(cleanup, 60_000);
  };
  document.body.append(frame);
}

export function useDownloadDocument() {
  return useMutationFeedback({
    mutationFn: async ({ id, kind }: { id: string; kind: DownloadKind }) => {
      const { blob, filename } = await apiFetchFile(`${documentPath(id)}/${kind}`);
      save(blob, filename ?? `${kind}-${id}`);
    },
    success: (_result, { kind }) => `Descargaste ${DOWNLOAD_NAMES[kind]}.`,
    invalidate: [[...DOCUMENTS_KEY, "deliveries"]],
    errorMessages: ERROR_MESSAGES,
  });
}

/**
 * Imprimir es una acción explícita: primero se registra la solicitud y, si el servidor la acepta,
 * se piden los mismos bytes del RIDE para el diálogo de impresión.
 */
export function usePrintRide() {
  return useMutationFeedback({
    mutationFn: async ({ id }: { id: string }) => {
      await apiFetch(`${documentPath(id)}/print-requests`, {
        method: "POST",
        schema: printRequestViewSchema,
      });
      const { blob } = await apiFetchFile(`${documentPath(id)}/ride`);
      printPdf(blob);
    },
    success: () => "Abrimos el RIDE para imprimir.",
    invalidate: [[...DOCUMENTS_KEY, "deliveries"]],
    errorMessages: ERROR_MESSAGES,
  });
}

export function useRetryRide(options: { onSuccess?: () => void } = {}) {
  return useMutationFeedback({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch(`${documentPath(id)}/ride-attempts`, {
        method: "POST",
        schema: documentSummaryViewSchema,
      }),
    success: () => "Volvimos a preparar el RIDE.",
    invalidate: [DOCUMENTS_KEY],
    ...(options.onSuccess ? { onSuccess: options.onSuccess } : {}),
  });
}

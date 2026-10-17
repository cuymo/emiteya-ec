// La consulta de la lista unificada de un tipo (unify-drafts-into-document-lists, design D1): los
// borradores primero y después los comprobantes emitidos, en una sola página del servidor. Cada tipo
// pone su ruta, su clave (que cuelga de la de sus comprobantes) y sus filtros.
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { documentEntryListMetaSchema } from "@facturador/contracts";
import { z } from "zod";
import { apiFetchPage } from "@/lib/api";

export function useDocumentEntries<T extends z.ZodType>({
  key,
  path,
  params,
  entry,
  enabled,
}: {
  key: readonly unknown[];
  /** Por ejemplo `/credit-notes/entries`. */
  path: string;
  /** Página, tamaño y filtros; los vacíos no se envían. */
  params: Record<string, string | number | undefined>;
  entry: T;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: [...key, params],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(params)) {
        if (value !== undefined && value !== "") query.set(name, String(value));
      }
      return apiFetchPage(`${path}?${query.toString()}`, {
        schema: z.array(entry),
        meta: documentEntryListMetaSchema,
        signal,
      });
    },
  });
}

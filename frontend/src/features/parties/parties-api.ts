// Datos de la pantalla Terceros (add-parties-and-products, design D11 y D17): lista paginada en el
// servidor, tipos de identificación vigentes del catálogo fiscal y mutaciones que pasan por
// useMutationFeedback.
"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  catalogEntriesViewSchema,
  partyListMetaSchema,
  partyViewSchema,
  type CreatePartyInput,
  type PartyRole,
  type PartyView,
  type RecordStatus,
  type UpdatePartyInput,
} from "@facturador/contracts";
import { z } from "zod";
import { useMutationFeedback, type SuccessFeedback } from "@/components/feedback";
import { apiFetch, apiFetchPage } from "@/lib/api";

export const PARTIES_KEY = ["parties"] as const;

/** Cierra la frase sin duplicar el punto de una razón social como "Andina S.A.". */
export const sentence = (text: string) => (text.endsWith(".") ? text : `${text}.`);

export type PartiesQuery = {
  search: string;
  status: RecordStatus | "ALL";
  role: PartyRole | undefined;
  page: number;
  pageSize: number;
};

export function useParties(query: PartiesQuery, enabled: boolean) {
  return useQuery({
    queryKey: [...PARTIES_KEY, query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({
        page: String(query.page),
        pageSize: String(query.pageSize),
        status: query.status,
      });
      if (query.search) params.set("search", query.search);
      if (query.role) params.set("role", query.role);
      return apiFetchPage(`/parties?${params.toString()}`, {
        schema: z.array(partyViewSchema),
        meta: partyListMetaSchema,
        signal,
      });
    },
  });
}

export type IdentificationTypeOption = {
  code: string;
  label: string;
  rule: string;
};

/** Un tercero, para corregirlo en su página. */
export function useParty(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...PARTIES_KEY, "detail", id],
    enabled,
    queryFn: ({ signal }) =>
      apiFetch(`/parties/${encodeURIComponent(id)}`, { schema: partyViewSchema, signal }),
  });
}

/** Tipos vigentes del catálogo fiscal, sin el reservado al consumidor final. */
export function useIdentificationTypes(enabled: boolean) {
  return useQuery({
    queryKey: ["fiscal-catalogs", "entries", "identification-type"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const view = await apiFetch("/fiscal-catalogs/identification-type/entries", {
        schema: catalogEntriesViewSchema,
        signal,
      });
      return view.entries.flatMap((entry): IdentificationTypeOption[] => {
        const version = entry.applicable;
        if (!version || version.identificationRule?.reservedFor) return [];
        return [
          {
            code: entry.code,
            label: version.officialLabel,
            rule: version.identificationRule?.description ?? "",
          },
        ];
      });
    },
  });
}

const sendParty = (method: "POST" | "PUT", path: string, json: unknown) =>
  apiFetch(path, { method, json, schema: partyViewSchema });

export function useSaveParty(options: {
  onSuccess: (party: PartyView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({ id, input }: { id?: string; input: CreatePartyInput | UpdatePartyInput }) =>
      id
        ? sendParty("PUT", `/parties/${encodeURIComponent(id)}`, input)
        : sendParty("POST", "/parties", input),
    success: (party, { id }) =>
      sentence(
        id ? `Guardaste los cambios de ${party.legalName}` : `Registraste a ${party.legalName}`,
      ),
    invalidate: [PARTIES_KEY],
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

/** Desactivar es reversible: un paso, con Deshacer en el aviso (escalera de confirmación). */
export function useChangePartyStatus() {
  const mutation = useMutationFeedback({
    mutationFn: ({ party, status }: { party: PartyView; status: RecordStatus }) =>
      sendParty("PUT", `/parties/${encodeURIComponent(party.id)}/status`, { status }),
    success: (party): SuccessFeedback =>
      party.status === "INACTIVE"
        ? {
            message: sentence(`Desactivaste a ${party.legalName}`),
            action: {
              label: "Deshacer",
              onClick: () => mutation.mutate({ party, status: "ACTIVE" }),
            },
          }
        : sentence(`Reactivaste a ${party.legalName}`),
    invalidate: [PARTIES_KEY],
  });
  return mutation;
}

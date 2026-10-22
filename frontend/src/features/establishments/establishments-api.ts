// Datos de establecimientos y puntos de emisión (add-taxpayer-setup, design D7 y D14). Toda
// mutación pasa por useMutationFeedback; desactivar ofrece Deshacer en el aviso, como en Usuarios.
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  defaultEmissionPointViewSchema,
  emissionPointViewSchema,
  establishmentViewSchema,
  type CreateEmissionPointInput,
  type CreateEstablishmentInput,
  type EmissionPointView,
  type EstablishmentStatus,
  type EstablishmentView,
} from "@facturador/contracts";
import { z } from "zod";
import { useMutationFeedback, type SuccessFeedback } from "@/components/feedback";
import { apiFetch } from "@/lib/api";
import { COMPANY_STATUS_KEY } from "@/features/company/company-api";
import { SEQUENCES_KEY } from "@/features/sequences/sequences-api";

export const ESTABLISHMENTS_KEY = ["establishments"] as const;
export const DEFAULT_POINT_KEY = ["default-emission-point"] as const;
// La disponibilidad cambia la preparación para emitir y el predeterminado de cada usuario; un punto
// nuevo trae sus secuenciales, que se ven en la misma pantalla.
const AFFECTED = [ESTABLISHMENTS_KEY, COMPANY_STATUS_KEY, DEFAULT_POINT_KEY, SEQUENCES_KEY];

export const pointLabel = (establishment: { code: string }, point: { code: string }) =>
  `${establishment.code}-${point.code}`;

/** El punto de emisión predeterminado del usuario, con el que nace un borrador nuevo. */
export function useDefaultEmissionPoint(enabled: boolean) {
  return useQuery({
    queryKey: DEFAULT_POINT_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/me/default-emission-point", { schema: defaultEmissionPointViewSchema, signal }),
  });
}

export function useEstablishments(enabled = true) {
  return useQuery({
    queryKey: ESTABLISHMENTS_KEY,
    enabled,
    queryFn: ({ signal }) =>
      apiFetch("/establishments", { schema: z.array(establishmentViewSchema), signal }),
  });
}

const path = (id: string) => `/establishments/${encodeURIComponent(id)}`;

export function useCreateEstablishment(options: {
  onSuccess: () => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: (input: CreateEstablishmentInput) =>
      apiFetch("/establishments", { method: "POST", json: input, schema: establishmentViewSchema }),
    success: (created) => `Creaste el establecimiento ${created.code}.`,
    invalidate: AFFECTED,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useUpdateAddress(options: {
  onSuccess: () => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({ id, address }: { id: string; address: string }) =>
      apiFetch(path(id), { method: "PUT", json: { address }, schema: establishmentViewSchema }),
    success: (updated) => `Actualizaste la dirección del establecimiento ${updated.code}.`,
    invalidate: AFFECTED,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useChangeEstablishmentStatus() {
  const mutation = useMutationFeedback({
    mutationFn: ({ id, status }: { id: string; status: EstablishmentStatus }) =>
      apiFetch(`${path(id)}/status`, {
        method: "PUT",
        json: { status },
        schema: establishmentViewSchema,
      }),
    success: (updated): SuccessFeedback =>
      updated.status === "INACTIVE"
        ? {
            message:
              updated.emissionPoints.length > 0
                ? `Desactivaste el establecimiento ${updated.code}. Sus puntos de emisión dejaron de estar disponibles.`
                : `Desactivaste el establecimiento ${updated.code}.`,
            action: {
              label: "Deshacer",
              onClick: () => mutation.mutate({ id: updated.id, status: "ACTIVE" }),
            },
          }
        : `Reactivaste el establecimiento ${updated.code}.`,
    invalidate: AFFECTED,
  });
  return mutation;
}

export function useCreateEmissionPoint(options: {
  onSuccess: () => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({
      establishment,
      input,
    }: {
      establishment: EstablishmentView;
      input: CreateEmissionPointInput;
    }) =>
      apiFetch(`${path(establishment.id)}/emission-points`, {
        method: "POST",
        json: input,
        schema: emissionPointViewSchema,
      }),
    success: (point, { establishment }) =>
      `Agregaste el punto de emisión ${pointLabel(establishment, point)}.`,
    invalidate: AFFECTED,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useChangeEmissionPointStatus() {
  const mutation = useMutationFeedback({
    mutationFn: ({
      establishment,
      point,
      status,
    }: {
      establishment: EstablishmentView;
      point: EmissionPointView;
      status: EstablishmentStatus;
    }) =>
      apiFetch(`${path(establishment.id)}/emission-points/${encodeURIComponent(point.id)}/status`, {
        method: "PUT",
        json: { status },
        schema: emissionPointViewSchema,
      }),
    success: (updated, { establishment }): SuccessFeedback =>
      updated.status === "INACTIVE"
        ? {
            message: `Desactivaste el punto de emisión ${pointLabel(establishment, updated)}.`,
            action: {
              label: "Deshacer",
              onClick: () => mutation.mutate({ establishment, point: updated, status: "ACTIVE" }),
            },
          }
        : `Reactivaste el punto de emisión ${pointLabel(establishment, updated)}.`,
    invalidate: AFFECTED,
  });
  return mutation;
}

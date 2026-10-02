// Datos de la pantalla Secuenciales (add-fiscal-numbering, design D12 y D14). El ajuste pasa por
// useMutationFeedback e invalida la lista del ambiente.
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  DOCUMENT_TYPE_LABELS,
  documentNumber,
  fiscalSequenceViewSchema,
  type AdjustSequenceInput,
  type Environment,
  type FiscalSequenceView,
} from "@facturador/contracts";
import { z } from "zod";
import { useMutationFeedback } from "@/components/feedback";
import { apiFetch } from "@/lib/api";
import { ENVIRONMENT_LABELS } from "@/features/company/company-api";

export const SEQUENCES_KEY = ["fiscal-sequences"] as const;

export const pointLabel = (view: FiscalSequenceView) =>
  `${view.establishment.code}-${view.emissionPoint.code}`;

export const sequenceKey = (view: FiscalSequenceView) =>
  `${view.environment}:${view.emissionPoint.id}:${view.documentType}`;

export function useSequences(environment: Environment | null, enabled: boolean) {
  return useQuery({
    queryKey: [...SEQUENCES_KEY, environment],
    enabled: enabled && environment !== null,
    queryFn: ({ signal }) =>
      apiFetch(`/fiscal-sequences?environment=${environment}`, {
        schema: z.array(fiscalSequenceViewSchema),
        signal,
      }),
  });
}

export function useAdjustSequence(options: {
  onSuccess: () => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: ({ view, input }: { view: FiscalSequenceView; input: AdjustSequenceInput }) =>
      apiFetch(
        `/establishments/${encodeURIComponent(view.establishment.id)}/emission-points/${encodeURIComponent(view.emissionPoint.id)}/sequences/${view.environment}/${view.documentType}`,
        { method: "PUT", json: input, schema: fiscalSequenceViewSchema },
      ),
    success: (updated) =>
      `Ajustaste el siguiente secuencial de ${DOCUMENT_TYPE_LABELS[updated.documentType].toLowerCase()} del punto ${pointLabel(updated)} (${ENVIRONMENT_LABELS[updated.environment]}) a ${documentNumber(updated.establishment.code, updated.emissionPoint.code, updated.nextNumber ?? 1)}.`,
    invalidate: [SEQUENCES_KEY],
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

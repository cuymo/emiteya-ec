// Datos de la configuración de la empresa (add-taxpayer-setup, design D6, D9 y D12): estado y
// preparación para emitir, configuración tributaria y logo. Toda mutación pasa por
// useMutationFeedback e invalida lo que cambia.
"use client";

import { useQuery } from "@tanstack/react-query";
import {
  companyStatusSchema,
  taxpayerViewSchema,
  type Environment,
  type ReadinessCheck,
  type TaxpayerView,
  type UpdateTaxpayerInput,
} from "@facturador/contracts";
import { useMutationFeedback } from "@/components/feedback";
import { apiFetch } from "@/lib/api";

export const COMPANY_STATUS_KEY = ["company-status"] as const;
export const TAXPAYER_KEY = ["taxpayer"] as const;

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  TEST: "Pruebas",
  PRODUCTION: "Producción",
};

/**
 * Ambiente y preparación (design D6): sin tiempo de frescura, se vuelven a consultar al volver a la
 * ventana y al entrar a Inicio, de modo que un cambio de ambiente se ve sin volver a iniciar sesión.
 */
export function useCompanyStatus() {
  return useQuery({
    queryKey: COMPANY_STATUS_KEY,
    queryFn: ({ signal }) => apiFetch("/company/status", { schema: companyStatusSchema, signal }),
    refetchOnWindowFocus: true,
  });
}

export function useTaxpayer(enabled = true) {
  return useQuery({
    queryKey: TAXPAYER_KEY,
    enabled,
    queryFn: ({ signal }) => apiFetch("/taxpayer", { schema: taxpayerViewSchema, signal }),
  });
}

export type ReadinessCopy = {
  title: string;
  met: string;
  pending: string;
  /** Destino y acción para resolverlo; la firma aún no tiene pantalla. */
  action?: { href: string; label: string };
};

export const READINESS_COPY: Record<ReadinessCheck, ReadinessCopy> = {
  TAXPAYER_DATA: {
    title: "Datos de la empresa",
    met: "Registrados.",
    pending: "Registra el RUC, la razón social y la dirección matriz.",
    action: { href: "/configuracion/empresa", label: "Registrar los datos de la empresa" },
  },
  EMISSION_POINT: {
    title: "Punto de emisión",
    met: "Hay al menos un punto de emisión disponible.",
    pending: "Crea un establecimiento con un punto de emisión activo.",
    action: { href: "/configuracion/establecimientos", label: "Crear un punto de emisión" },
  },
  SIGNING_CERTIFICATE: {
    title: "Firma electrónica",
    met: "Vigente.",
    pending: "Disponible próximamente.",
  },
};

const CONFIG_KEYS = [TAXPAYER_KEY, COMPANY_STATUS_KEY];

export function useUpdateTaxpayer(options: {
  onSuccess: (view: TaxpayerView) => void;
  onError: (error: unknown) => boolean;
}) {
  return useMutationFeedback({
    mutationFn: (input: UpdateTaxpayerInput) =>
      apiFetch("/taxpayer", { method: "PUT", json: input, schema: taxpayerViewSchema }),
    success: (view, input) =>
      view.version === input.expectedVersion
        ? "No había cambios que guardar."
        : `Guardaste los datos de la empresa (versión ${view.version}).`,
    invalidate: CONFIG_KEYS,
    onSuccess: options.onSuccess,
    onError: options.onError,
  });
}

export function useChangeEnvironment(options: { onSuccess: () => void }) {
  return useMutationFeedback({
    mutationFn: (input: { environment: Environment; expectedVersion: number }) =>
      apiFetch("/taxpayer/environment", { method: "PUT", json: input, schema: taxpayerViewSchema }),
    success: (view) => `La empresa está ahora en ${ENVIRONMENT_LABELS[view.environment]}.`,
    invalidate: CONFIG_KEYS,
    onSuccess: options.onSuccess,
  });
}

export function useReplaceLogo(options: { onSuccess: (view: TaxpayerView) => void }) {
  return useMutationFeedback({
    mutationFn: ({ file, expectedVersion }: { file: File; expectedVersion: number }) =>
      apiFetch(`/taxpayer/logo?expectedVersion=${expectedVersion}`, {
        method: "PUT",
        binary: file,
        schema: taxpayerViewSchema,
      }),
    success: (view, { expectedVersion }) =>
      view.version === expectedVersion ? "El logo ya era ese." : "Actualizaste el logo.",
    invalidate: [TAXPAYER_KEY],
    onSuccess: options.onSuccess,
  });
}

export function useRemoveLogo(options: { onSuccess: (view: TaxpayerView) => void }) {
  return useMutationFeedback({
    mutationFn: ({ expectedVersion }: { expectedVersion: number }) =>
      apiFetch(`/taxpayer/logo?expectedVersion=${expectedVersion}`, {
        method: "DELETE",
        schema: taxpayerViewSchema,
      }),
    success: () => "Eliminaste el logo. Los comprobantes ya emitidos conservan el suyo.",
    invalidate: [TAXPAYER_KEY],
    onSuccess: options.onSuccess,
  });
}

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
} from "@facturador/contracts";
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

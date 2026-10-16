// Datos del tablero de Inicio: el resumen que calcula el servidor (`GET /dashboard`) en el ambiente
// vigente de la empresa. Se actualiza al volver a la ventana, como el ambiente.
"use client";

import { useQuery } from "@tanstack/react-query";
import { dashboardViewSchema } from "@facturador/contracts";
import { apiFetch } from "@/lib/api";

export const DASHBOARD_KEY = ["dashboard"] as const;

export function useDashboard(enabled: boolean) {
  return useQuery({
    queryKey: DASHBOARD_KEY,
    enabled,
    refetchOnWindowFocus: true,
    queryFn: ({ signal }) => apiFetch("/dashboard", { schema: dashboardViewSchema, signal }),
  });
}

// Aviso del ambiente en el shell (design D6 y D27, ERS RF-004 y RF-005). El distintivo con el texto
// del ambiente va en la barra superior, que es fija, a todas las anchuras: el ambiente sigue a la
// vista al desplazar, también en un teléfono. En Pruebas, además, una franja persistente sin cierre,
// en una superficie neutra con acento de advertencia para que no canse. Producción es contexto, no un
// resultado: su distintivo es neutro y de alta atención, sin el verde de éxito. Mientras carga se
// reserva el espacio, y ante un error nunca se supone Producción.
"use client";

import { Radio, TriangleAlert } from "lucide-react";
import { NoticeStrip as Strip } from "@/components/notice-strip";
import { Skeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { useCompanyStatus } from "./company-api";

export function EnvironmentNotice() {
  const status = useCompanyStatus();
  if (status.isPending) {
    return <div aria-hidden="true" className="h-8 border-b border-border bg-surface-subtle" />;
  }
  if (status.isError) {
    return (
      <Strip tone="warning">
        Ambiente desconocido: no pudimos confirmar si los comprobantes tienen validez tributaria.
      </Strip>
    );
  }
  if (status.data.environment === "PRODUCTION") return null;
  return (
    <Strip tone="environment">
      Ambiente de Pruebas: los comprobantes no tienen validez tributaria.
    </Strip>
  );
}

/**
 * Distintivo de la barra superior, a todas las anchuras (design D27). Usa el `Badge` derivado de la
 * plantilla (adopt-premium-design-foundation-and-shell, design D11): texto e icono, nunca solo color.
 */
export function EnvironmentBadge() {
  const status = useCompanyStatus();
  if (status.isPending) return <Skeleton className="h-5 w-20 shrink-0 rounded-4xl" />;
  if (status.isError) return null;
  return status.data.environment === "PRODUCTION" ? (
    <Badge variant="emphasis" className="shrink-0">
      <Radio aria-hidden="true" />
      Producción
    </Badge>
  ) : (
    <Badge variant="warning" className="shrink-0">
      <TriangleAlert aria-hidden="true" />
      Pruebas
    </Badge>
  );
}

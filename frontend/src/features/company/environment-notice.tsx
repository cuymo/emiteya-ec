// Aviso del ambiente en el shell (design D6, ERS RF-004 y RF-005). En Pruebas, una franja
// persistente sin cierre en todas las pantallas; en Producción, el distintivo de la cabecera. Por
// debajo de 640px la cabecera no tiene espacio para el distintivo, así que Producción se indica con
// una línea compacta bajo ella. Mientras carga se reserva el espacio, y ante un error nunca se supone
// Producción.
"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
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
  if (status.data.environment === "PRODUCTION") {
    return (
      <Strip tone="success" className="sm:hidden">
        Ambiente de Producción
      </Strip>
    );
  }
  return (
    <Strip tone="warning">
      Ambiente de Pruebas: los comprobantes no tienen validez tributaria.
    </Strip>
  );
}

/**
 * Distintivo de la barra superior, desde 640px; por debajo lo sustituye la línea de
 * EnvironmentNotice. Usa el `Badge` derivado de la plantilla (adopt-premium-design-foundation-and-shell,
 * design D11): texto e icono, nunca solo color.
 */
export function EnvironmentBadge() {
  const status = useCompanyStatus();
  if (status.isPending) return <Skeleton className="hidden h-5 w-20 rounded-4xl sm:block" />;
  if (status.isError) return null;
  return status.data.environment === "PRODUCTION" ? (
    <Badge variant="success" className="hidden sm:inline-flex">
      <CircleCheck aria-hidden="true" />
      Producción
    </Badge>
  ) : (
    <Badge variant="warning" className="hidden sm:inline-flex">
      <TriangleAlert aria-hidden="true" />
      Pruebas
    </Badge>
  );
}

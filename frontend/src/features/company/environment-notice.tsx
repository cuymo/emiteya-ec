// Aviso del ambiente en el shell (design D6, ERS RF-004 y RF-005). En Pruebas, una franja
// persistente sin cierre en todas las pantallas; en Producción, el distintivo de la cabecera. Por
// debajo de 640px la cabecera no tiene espacio para el distintivo, así que Producción se indica con
// una línea compacta bajo ella. Mientras carga se reserva el espacio, y ante un error nunca se supone
// Producción.
"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import { Skeleton, StatusBadge } from "@/components/states";
import { cn } from "@/lib/utils";
import { useCompanyStatus } from "./company-api";

function Strip({
  tone,
  className,
  children,
}: {
  tone: "warning" | "success";
  className?: string;
  children: string;
}) {
  const Icon = tone === "warning" ? TriangleAlert : CircleCheck;
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-1 border-b px-1 py-0.5 text-sm md:px-2",
        tone === "warning" ? "border-warning/40 bg-warning/10" : "border-border bg-surface",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-2 shrink-0", tone === "warning" ? "text-warning" : "text-success")}
      />
      <p>{children}</p>
    </div>
  );
}

export function EnvironmentNotice() {
  const status = useCompanyStatus();
  if (status.isPending) {
    return <div aria-hidden="true" className="h-4 border-b border-border bg-surface-subtle" />;
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

/** Distintivo de la cabecera, desde 640px; por debajo lo sustituye la línea de EnvironmentNotice. */
export function EnvironmentBadge() {
  const status = useCompanyStatus();
  if (status.isPending) return <Skeleton className="hidden h-3 w-9 sm:block" />;
  if (status.isError) return null;
  return (
    <span className="hidden sm:inline-flex">
      {status.data.environment === "PRODUCTION" ? (
        <StatusBadge tone="success" label="Producción" icon={CircleCheck} />
      ) : (
        <StatusBadge tone="warning" label="Pruebas" icon={TriangleAlert} />
      )}
    </span>
  );
}

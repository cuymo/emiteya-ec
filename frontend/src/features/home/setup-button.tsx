// «Falta configurar» en la barra superior (redesign-dashboard-indicators, tarea 4.1; decisión del
// propietario, 2026-10-24): mientras la empresa no pueda emitir, lleva a «Primeros pasos» con el número
// de requisitos pendientes. Con la empresa lista, o mientras se consulta, no se muestra. En un teléfono
// queda el icono con el número; el nombre accesible dice siempre cuántos faltan.
"use client";

import { ListChecks } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCompanyStatus } from "@/features/company/company-api";
import { PRIMEROS_PASOS } from "@/lib/navigation/routes";
import { cn } from "@/lib/utils";

export function SetupButton() {
  const status = useCompanyStatus();
  const pathname = usePathname();
  const readiness = status.data?.readiness;
  if (!readiness || readiness.ready) return null;
  const pending = readiness.checks.filter((check) => check.status === "PENDING").length;
  const current = pathname === PRIMEROS_PASOS.href;
  const label = `Falta configurar: ${pending === 1 ? "1 requisito pendiente" : `${pending} requisitos pendientes`} para emitir`;
  return (
    <Link
      href={PRIMEROS_PASOS.href}
      aria-label={label}
      title={label}
      aria-current={current ? "page" : undefined}
      data-tour="primeros-pasos"
      className={cn(
        "relative inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 text-sm font-medium text-foreground transition-colors hover:bg-warning/20 max-md:size-11 max-md:justify-center max-md:px-0",
        current && "ring-2 ring-warning/40",
      )}
    >
      <ListChecks aria-hidden="true" className="size-4 text-warning" />
      <span className="max-md:sr-only">Falta configurar</span>
      <span
        aria-hidden="true"
        className="flex min-w-5 items-center justify-center rounded-full bg-warning px-1.5 text-xs font-semibold text-warning-foreground tabular-nums max-md:absolute max-md:translate-x-3 max-md:-translate-y-3"
      >
        {pending}
      </span>
    </Link>
  );
}

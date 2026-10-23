// Contexto de la empresa en la barra superior (adopt-premium-design-foundation-and-shell, design D11;
// spec web-application-shell, «Contexto de la empresa visible»). Adapta el patrón visual de
// `account-switcher.tsx` de la plantilla «Studio Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md) a un
// contexto de solo lectura: no abre nada propio y no sugiere un cambio de empresa que el sistema no
// tiene. Es presentación pura: el layout le pasa el estado de la empresa de la sesión. Va dentro del
// disparador del menú de cuenta, con la ficha del edificio a su lado y la cuenta debajo (decisión del
// propietario, 2026-10-22), así que solo usa elementos en línea.
import { Building2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type CompanyContextState =
  | { status: "loading" }
  | { status: "error" }
  /** La empresa todavía no tiene datos registrados: no hay nombre que mostrar. */
  | { status: "unnamed" }
  | { status: "ready"; name: string };

export function CompanyContext({
  state,
  className,
}: {
  state: CompanyContextState;
  className?: string;
}) {
  if (state.status === "loading") {
    return (
      <span aria-hidden="true" className={cn("flex min-w-0 items-center gap-2", className)}>
        <span className="size-6 rounded-full bg-muted motion-safe:animate-pulse" />
        <span className="h-4 w-28 rounded-md bg-muted motion-safe:animate-pulse" />
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-warning",
          className,
        )}
      >
        <TriangleAlert aria-hidden="true" />
        <span className="truncate">No pudimos confirmar la empresa</span>
      </span>
    );
  }
  if (state.status === "unnamed") {
    return (
      <span
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0",
          className,
        )}
      >
        <Building2 aria-hidden="true" />
        <span className="truncate">Empresa sin datos registrados</span>
      </span>
    );
  }
  return (
    <span
      data-slot="company-context"
      className={cn("flex min-w-0 items-center gap-2 text-sm font-semibold", className)}
      title={state.name}
    >
      <span className="sr-only">Empresa: </span>
      <span className="truncate">{state.name}</span>
    </span>
  );
}

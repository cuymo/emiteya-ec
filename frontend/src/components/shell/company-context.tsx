// Contexto de la empresa en la barra superior (adopt-premium-design-foundation-and-shell, design D11;
// spec web-application-shell, «Contexto de la empresa visible»). Adapta el patrón visual de
// `account-switcher.tsx` de la plantilla «Studio Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md) a un
// contexto de solo lectura: no es un botón, no abre nada y no sugiere un cambio de empresa que el
// sistema no tiene. Es presentación pura: el layout le pasa el estado de la empresa de la sesión.
import { Building2, TriangleAlert } from "lucide-react";
import { Avatar, AvatarFallback, initials } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
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
      <div className={cn("flex min-w-0 items-center gap-2", className)}>
        <Skeleton className="size-6 rounded-full" />
        <Skeleton className="h-4 w-28" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <p
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-warning",
          className,
        )}
      >
        <TriangleAlert aria-hidden="true" />
        <span className="truncate">No pudimos confirmar la empresa</span>
      </p>
    );
  }
  if (state.status === "unnamed") {
    return (
      <p
        className={cn(
          "flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground [&>svg]:size-4 [&>svg]:shrink-0",
          className,
        )}
      >
        <Building2 aria-hidden="true" />
        <span className="truncate">Empresa sin datos registrados</span>
      </p>
    );
  }
  return (
    <p
      data-slot="company-context"
      className={cn("flex min-w-0 items-center gap-2 text-sm font-medium", className)}
      title={state.name}
    >
      {/* En un teléfono estrecho la ficha cede su sitio al nombre, que es lo que pide la spec
          (productize-invoice-editor-and-composition-foundation, design D1). */}
      <Avatar size="sm" className="rounded-md after:rounded-md max-md:@max-topbar-company:hidden">
        <AvatarFallback className="rounded-md text-xs font-semibold">
          {initials(state.name)}
        </AvatarFallback>
      </Avatar>
      <span className="sr-only">Empresa: </span>
      <span className="truncate">{state.name}</span>
    </p>
  );
}

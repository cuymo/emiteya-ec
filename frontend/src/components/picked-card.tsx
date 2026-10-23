// Lo elegido en un formulario, como una ficha (decisión del propietario, 2026-10-22): un ícono grande
// en un círculo, los datos y, en la misma fila y a la derecha, las acciones para elegirlo o cambiarlo.
// Sin elección, el borde es punteado y el ícono queda apagado. En un teléfono, las acciones bajan.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PickedCard({
  icon: Icon,
  picked,
  actions,
  className,
  children,
}: {
  icon: LucideIcon;
  /** Si ya hay algo elegido: el borde sólido y el ícono en azul. */
  picked: boolean;
  /** Los botones de la derecha, como «Cambiar»; uno o varios. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-slot="picked-card"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-md border bg-surface px-3 py-3 sm:flex-nowrap",
        picked ? "border-border" : "border-dashed",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            picked ? "bg-primary/10 text-primary" : "bg-muted text-foreground-muted",
          )}
        >
          <Icon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col">{children}</div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">{actions}</div>
      )}
    </div>
  );
}

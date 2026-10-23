// Un elemento numerado de una lista de un formulario, como un concepto o una línea (decisiones del
// propietario, 2026-10-22): dos columnas, 10 % y 90 %. En la primera, su rótulo («Concepto 1»,
// «Línea 2») vertical en azul sobre una franja con un degradado azul discreto; en la segunda, sus
// campos. En un teléfono, el rótulo va horizontal arriba. El rótulo es el `h3` del elemento.
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function NumberedItem({
  label,
  invalid = false,
  className,
  children,
  ...props
}: Omit<ComponentProps<"li">, "children"> & {
  label: string;
  /** Si el elemento tiene problemas: el borde va en rojo. */
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      aria-invalid={invalid || undefined}
      {...props}
      className={cn(
        "grid overflow-hidden rounded-md border border-border bg-surface aria-invalid:border-danger sm:grid-cols-[minmax(0,10fr)_minmax(0,90fr)]",
        className,
      )}
    >
      <div
        data-slot="item-number"
        className="flex items-center justify-center border-primary/15 bg-linear-to-b from-primary/20 via-primary/10 to-primary/5 px-3 py-2 text-primary max-sm:border-b sm:border-r sm:py-4"
      >
        <h3 className="font-semibold whitespace-nowrap sm:rotate-180 sm:[writing-mode:vertical-rl]">
          {label}
        </h3>
      </div>
      <div className="@container flex min-w-0 flex-col gap-3 p-3">{children}</div>
    </li>
  );
}

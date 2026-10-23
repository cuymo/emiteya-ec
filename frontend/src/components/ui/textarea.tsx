// Área de texto del sistema (decisión del propietario, 2026-10-22): tres líneas que se pueden agrandar
// hacia abajo, con el mismo borde, fondo y tipografía que `Input`. `SingleLineTextarea` la usa para
// los textos que el comprobante lleva en una sola línea.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, rows = 3, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-surface px-3 py-2 text-base text-foreground sm:text-sm aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

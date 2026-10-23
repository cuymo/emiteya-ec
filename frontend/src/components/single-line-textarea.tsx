// Un texto largo que el comprobante lleva en una sola línea, como la descripción de un concepto o de
// una línea (decisión del propietario, 2026-10-22): un área de texto de tres líneas que se puede
// agrandar, donde Enter no parte la línea y los saltos de línea pegados se vuelven espacios. Lo
// acompaña la cuenta de caracteres en la ayuda del campo.
"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function SingleLineTextarea({
  onChange,
  onKeyDown,
  className,
  rows = 3,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={rows}
      {...props}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
        onKeyDown?.(event);
      }}
      onChange={(event) => {
        if (/[\r\n]/.test(event.target.value)) {
          event.target.value = event.target.value.replace(/[\r\n]+/g, " ");
        }
        onChange?.(event);
      }}
      className={cn(
        "min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-surface px-3 py-2 text-base text-foreground sm:text-sm aria-invalid:border-danger",
        className,
      )}
    />
  );
}

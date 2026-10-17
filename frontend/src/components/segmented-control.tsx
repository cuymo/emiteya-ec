// SegmentedControl (component-system.md): de dos a cinco opciones excluyentes y visibles a la vez,
// con geometría estable. Admite empezar sin selección cuando el dato debe declararse (no inferirse).
// La opción elegida es una pieza elevada en el azul primario dentro de una pista neutra (decisión del
// propietario, 2026-10-17: lo activo va en azul en toda la aplicación); su forma la distingue además
// del color.
"use client";

import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = { value: T; label: string };

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  id,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  disabled,
}: {
  options: readonly SegmentedOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value ?? ""}
      // Una opción elegida no se deselecciona: el valor cambia solo a otra opción.
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      {...(id ? { id } : {})}
      {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      {...(invalid ? { "aria-invalid": true } : {})}
      {...(disabled ? { disabled } : {})}
      className={cn(
        "inline-flex w-fit rounded-md border border-input bg-muted p-1",
        invalid && "border-danger",
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            // Altura mínima, no fija: una etiqueta larga que se parte en líneas crece dentro del borde.
            "min-h-8 min-w-16 rounded-sm px-3 py-1 text-sm leading-tight font-medium text-foreground-muted max-md:min-h-11",
            "motion-safe:transition-colors motion-safe:duration-150",
            "hover:text-foreground",
            // El borde de la pieza elegida contrasta con la pista y con su relleno en los dos temas.
            "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-primary data-[state=on]:hover:text-primary-foreground",
            "disabled:opacity-50",
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

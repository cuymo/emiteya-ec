// ChipMultiSelect (component-selection.md): etiquetas o categorías cortas que se combinan, como los
// roles de un tercero. Chips conmutables de selección múltiple sobre Radix ToggleGroup; la selección
// vacía es válida. Como pestañas (`appearance="tabs"`, decisión del propietario, 2026-10-22): a todo
// el ancho, en partes iguales dentro de una pista, como `SegmentedControl`, pero cada opción elegida
// lleva una marca, porque aquí se pueden elegir varias.
"use client";

import { Check } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export function ChipMultiSelect<T extends string>({
  options,
  value,
  onChange,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  disabled,
  appearance = "chips",
}: {
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (value: T[]) => void;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  disabled?: boolean;
  appearance?: "chips" | "tabs";
}) {
  const tabs = appearance === "tabs";
  return (
    <ToggleGroup.Root
      type="multiple"
      value={[...value]}
      // Conserva el orden de las opciones, no el de los clics.
      onValueChange={(next) =>
        onChange(options.map((o) => o.value).filter((v) => next.includes(v)))
      }
      {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      disabled={disabled}
      className={
        tabs
          ? "flex w-full gap-1 rounded-md border border-input bg-muted p-1"
          : "flex flex-wrap gap-1"
      }
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "motion-safe:transition-colors motion-safe:duration-150",
            "disabled:cursor-not-allowed disabled:opacity-50",
            tabs
              ? [
                  "group/tab inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-sm px-3 py-1 text-sm font-medium text-foreground-muted max-md:min-h-11",
                  "hover:bg-surface hover:text-foreground",
                  "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-primary data-[state=on]:hover:bg-primary/90",
                ]
              : [
                  "h-8 rounded-full border border-input px-3 text-sm text-foreground max-md:h-11",
                  "hover:bg-surface-subtle data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
                ],
          )}
        >
          {tabs && (
            <Check
              aria-hidden="true"
              className="hidden size-4 shrink-0 group-data-[state=on]/tab:block"
            />
          )}
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

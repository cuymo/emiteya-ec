// ChipMultiSelect (component-selection.md): etiquetas o categorías cortas que se combinan, como los
// roles de un tercero. Chips conmutables de selección múltiple sobre Radix ToggleGroup; la selección
// vacía es válida.
"use client";

import { ToggleGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export function ChipMultiSelect<T extends string>({
  options,
  value,
  onChange,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  disabled,
}: {
  options: readonly { value: T; label: string }[];
  value: readonly T[];
  onChange: (value: T[]) => void;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  disabled?: boolean;
}) {
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
      className="flex flex-wrap gap-1"
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "h-8 rounded-full border border-input px-3 text-sm text-foreground max-md:h-11",
            "motion-safe:transition-colors motion-safe:duration-150",
            "hover:bg-surface-subtle data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

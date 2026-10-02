// SegmentedControl (component-system.md): de dos a cinco opciones excluyentes y visibles a la vez,
// con geometría estable. Admite empezar sin selección cuando el dato debe declararse (no inferirse).
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
        "inline-flex w-fit rounded-md border border-input bg-surface p-0.5",
        invalid && "border-danger",
      )}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "h-4 min-w-8 rounded-sm px-1.5 text-sm font-medium text-foreground-muted max-md:h-5.5",
            "motion-safe:transition-colors motion-safe:duration-150",
            "hover:bg-surface-subtle hover:text-foreground",
            "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
            "disabled:opacity-50",
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

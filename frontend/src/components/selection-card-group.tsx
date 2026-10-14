// SelectionCardGroup (component-system.md): elección entre opciones con diferencias que importan,
// como grupo de radio de Radix con teclado y anuncio accesible.
"use client";

import { RadioGroup } from "radix-ui";
import { cn } from "@/lib/utils";

export type SelectionCardOption<T extends string> = {
  value: T;
  label: string;
  description: string;
};

export function SelectionCardGroup<T extends string>({
  options,
  value,
  onChange,
  name,
  "aria-labelledby": labelledBy,
  disabled,
}: {
  options: readonly SelectionCardOption<T>[];
  value: T;
  onChange: (value: T) => void;
  name?: string;
  "aria-labelledby"?: string;
  disabled?: boolean;
}) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onChange(next as T)}
      {...(name ? { name } : {})}
      {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}
      {...(disabled ? { disabled } : {})}
      className="grid gap-2 sm:grid-cols-2"
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "flex flex-col items-start gap-1 rounded-lg border border-border bg-surface p-3 text-left",
            "motion-safe:transition-colors motion-safe:duration-150",
            "hover:bg-surface-subtle data-[state=checked]:border-primary data-[state=checked]:bg-primary/5",
            "disabled:opacity-50",
          )}
        >
          <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
            {option.label}
            <span
              aria-hidden="true"
              className="inline-flex size-4 items-center justify-center rounded-full border border-border"
            >
              <RadioGroup.Indicator className="size-2 rounded-full bg-primary" />
            </span>
          </span>
          <span className="text-xs text-foreground-muted">{option.description}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

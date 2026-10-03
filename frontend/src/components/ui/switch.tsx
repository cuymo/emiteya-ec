// Switch (component-selection.md): un ajuste que aplica en el momento, no un campo de formulario.
// Radix Switch con los tokens del proyecto; objetivo táctil de 44px por debajo de 768px.
"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        // El área táctil crece en móvil; la pista visible conserva su tamaño.
        "group relative inline-flex h-5 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full max-md:h-5.5 max-md:w-9",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex h-3 w-6 items-center rounded-full border border-input bg-surface-subtle p-0.5",
          "motion-safe:transition-colors motion-safe:duration-150",
          "group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary",
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block size-2 rounded-full bg-foreground-muted shadow-sm",
            "motion-safe:transition-transform motion-safe:duration-150",
            "data-[state=checked]:translate-x-3 data-[state=checked]:bg-primary-foreground",
          )}
        />
      </span>
    </SwitchPrimitive.Root>
  );
}

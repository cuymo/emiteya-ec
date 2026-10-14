// Campo de texto y etiqueta base (shadcn/ui adaptado a los tokens).
import { Label as LabelPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-input bg-surface px-3 text-base text-foreground sm:text-sm max-md:h-11",
        "placeholder:text-foreground-muted",
        "motion-safe:transition-colors motion-safe:duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

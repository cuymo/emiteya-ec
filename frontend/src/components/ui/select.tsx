// Select (component-system.md): de cinco a quince opciones conocidas. Es el select nativo con los
// tokens del proyecto, que conserva teclado, lector de pantalla y selector táctil del sistema, y
// admite grupos con <optgroup>. Mide 44px de alto por debajo de 768px, como Input y Button.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-5 w-full min-w-0 rounded-md border border-input bg-surface px-1.5 text-base text-foreground sm:text-sm max-md:h-5.5",
        "motion-safe:transition-colors motion-safe:duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

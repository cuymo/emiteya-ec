// Derivado de la plantilla «Studio Admin» 2.2.0, `src/components/ui/toggle.tsx` (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Aporta las variantes que comparte `toggle-group`
// (productize-invoice-list-and-shared-table-foundation, D3). Adaptado:
// - anillo de foco sólido, como el resto de los primitivos, sin la transparencia de la plantilla;
// - sin valores arbitrarios (`ring-[3px]`, `rounded-[min(...)]`, `text-[0.8rem]`): tamaños de la
//   escala aprobada, 32 px (`default`) y 28 px (`sm`), con 44 px de objetivo táctil por debajo de
//   768 px;
// - la selección es neutra (`data-[state=on]:bg-muted`): el azul principal queda para la acción
//   principal de la pantalla.
import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const toggleVariants = cva(
  [
    "group/toggle inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap text-muted-foreground",
    "outline-none motion-safe:transition-colors hover:bg-muted hover:text-foreground",
    "focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    "aria-pressed:bg-muted aria-pressed:text-foreground data-[state=on]:bg-muted data-[state=on]:text-foreground",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent",
      },
      size: {
        default: "h-8 min-w-8 px-2.5 max-md:h-11",
        sm: "h-7 min-w-7 rounded-md px-2 text-xs max-md:h-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size }), className)}
      {...props}
    />
  );
}

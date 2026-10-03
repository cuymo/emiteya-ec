// Botón base (shadcn/ui adaptado a los tokens). Niveles de acción de component-selection.md:
// primary (uno por superficie), outline (secundaria), ghost (terciaria) y destructive.
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
  outline:
    "border border-border bg-surface text-foreground hover:bg-surface-subtle active:bg-border",
  ghost: "text-foreground hover:bg-surface-subtle active:bg-border",
  destructive: "bg-danger text-danger-foreground hover:bg-danger/90 active:bg-danger/80",
} as const;

// Por debajo de 768px todo objetivo táctil mide al menos 44px (frontend.md).
const SIZES = {
  md: "h-5 gap-1 px-2 text-sm max-md:h-5.5",
  sm: "h-4 gap-0.5 px-1.5 text-sm max-md:h-5.5",
  // Objetivo táctil de 44px para acciones independientes (cabecera, cierre de diálogo).
  icon: "size-5.5",
  "icon-sm": "size-5",
} as const;

export type ButtonProps = ComponentProps<"button"> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  asChild?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  asChild = false,
  className,
  type,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      type={asChild ? undefined : (type ?? "button")}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap",
        "motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-standard",
        "disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50",
        "[&_svg]:size-2.5 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

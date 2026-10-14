// Derivado de la plantilla «Studio Admin» 2.2.0, `src/components/ui/button.tsx` (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Es el único botón del frontend. Adaptado
// (adopt-premium-design-foundation-and-shell, design D5 y D6):
// - variantes con los nombres de EmiteYa (`primary` es el `default` de la plantilla); el botón de
//   solo icono es un tamaño, no un color, y siempre lleva `aria-label`;
// - tamaños de la escala aprobada: 36 px (`default`), 32 px (`sm`) y 24 px (`xs`, solo dentro de
//   chips), con 44 px de objetivo táctil por debajo de 768 px;
// - anillo de foco sólido, sin la transparencia de la plantilla;
// - `type="button"` por defecto, como el botón anterior, para no enviar formularios sin querer;
// - tamaños `legacy-*` transitorios (technical-debt.md): conservan alto, relleno, separación,
//   objetivo táctil y tamaño de icono del botón anterior en las pantallas aún no migradas. El código
//   nuevo no los usa (regla de lint del shell).
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding",
    "text-sm font-medium whitespace-nowrap transition-all outline-none select-none",
    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring",
    "active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50",
    "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/80",
        // Hover de la plantilla: el secundario mezclado con un 5 % del texto (excepción documentada
        // en el ADR 0028; no hay token para ese paso).
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive focus-visible:ring-destructive dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 max-md:h-11",
        sm: "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 max-md:h-11",
        // 24 px visibles; en móvil, un área táctil de 44 px alrededor sin cambiar la caja.
        xs: "relative h-6 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3 max-md:after:absolute max-md:after:-inset-2.5",
        icon: "size-9 max-md:size-11",
        "icon-sm": "size-8 max-md:size-11",
        "icon-xs":
          "relative size-6 rounded-md [&_svg:not([class*='size-'])]:size-3 max-md:after:absolute max-md:after:-inset-2.5",
        "legacy-md": "h-10 gap-2 px-4 max-md:h-11 [&_svg]:size-5",
        "legacy-sm": "h-8 gap-1 px-3 max-md:h-11 [&_svg]:size-5",
        "legacy-icon": "size-11 [&_svg]:size-5",
        "legacy-icon-sm": "size-10 [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "legacy-md",
    },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({
  className,
  variant = "primary",
  size = "legacy-md",
  asChild = false,
  type,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      data-slot="button"
      data-variant={variant}
      data-size={size}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

// Derivado de la plantilla «Studio Admin» 2.2.0, `src/components/ui/badge.tsx` (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Adaptado (adopt-premium-design-foundation-and-shell, design D6):
// variantes semánticas de EmiteYa en lugar de las de la plantilla. En un estado, el color va en el
// icono, el borde y el fondo; el texto queda en `foreground` para conservar el contraste, y el estado
// nunca se comunica solo con color: lleva icono y texto. Anillo de foco sólido.
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  [
    "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border",
    "px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground transition-all",
    "focus-visible:ring-2 focus-visible:ring-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
    "[&>svg]:pointer-events-none [&>svg]:size-3!",
  ],
  {
    variants: {
      variant: {
        success: "border-success/30 bg-success/10 [&>svg]:text-success",
        warning: "border-warning/40 bg-warning/10 [&>svg]:text-warning",
        info: "border-info/30 bg-info/10 [&>svg]:text-info",
        destructive: "border-destructive/30 bg-destructive/10 [&>svg]:text-destructive",
        neutral: "border-border bg-muted [&>svg]:text-muted-foreground",
        outline: "border-border",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export function Badge({
  className,
  variant = "neutral",
  asChild = false,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : "span";
  return (
    <Component
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

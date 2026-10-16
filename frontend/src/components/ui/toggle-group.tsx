// Derivado de la plantilla «Studio Admin» 2.2.0, `src/components/ui/toggle-group.tsx` (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Fue la base de las vistas de una lista
// (productize-invoice-list-and-shared-table-foundation, D3 y D6), que hoy son desplegables
// (`DataTableSelectFilter`); queda como primitivo sin uso en las pantallas. Adaptado a la CSP: la plantilla
// escribe la separación en `style={{ "--gap": spacing }}`, que `style-src-attr 'none'` bloquea; aquí
// la separación es una clase de la escala (0, 1 o 2). Con `type="single"`, Radix 1.6.7 expone un
// grupo de radio que se recorre con las flechas. Su foco itinerante pone `outline:none` como estilo
// de la raíz: las pantallas autenticadas lo pintan en el cliente, donde React lo aplica por CSSOM
// (la CSP lo permite).
"use client";

import type { VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { createContext, useContext, type ComponentProps } from "react";
import { toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

type Spacing = 0 | 1 | 2;

const GAPS: Record<Spacing, string> = { 0: "gap-0", 1: "gap-1", 2: "gap-2" };

const ToggleGroupContext = createContext<
  VariantProps<typeof toggleVariants> & { spacing: Spacing }
>({ variant: "default", size: "default", spacing: 1 });

export function ToggleGroup({
  className,
  variant,
  size,
  spacing = 1,
  children,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof toggleVariants> & { spacing?: Spacing }) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-spacing={spacing}
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center",
        GAPS[spacing],
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size, spacing }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive.Root>
  );
}

export function ToggleGroupItem({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
  const context = useContext(ToggleGroupContext);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        toggleVariants({ variant: context.variant ?? variant, size: context.size ?? size }),
        "shrink-0 focus-visible:z-10",
        context.spacing === 0 && "rounded-none first:rounded-l-lg last:rounded-r-lg",
        className,
      )}
      {...props}
    />
  );
}

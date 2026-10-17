// Derivado de la plantilla «Studio Admin», `src/components/ui/tabs.tsx` (MIT;
// frontend/THIRD_PARTY_NOTICES.md), sobre las pestañas de Radix. Adaptado: solo la orientación
// horizontal, que es la que usa el producto, y la variante de línea con su subrayado bajo la pestaña
// activa. El teclado (flechas, Inicio y Fin) y los roles `tablist`, `tab` y `tabpanel` los da Radix.
// Las pestañas que navegan entre páginas son enlaces con el mismo aspecto (`tabTriggerClassName`).
"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("group/tabs flex flex-col gap-4", className)}
      {...props}
    />
  );
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "flex w-full items-center gap-1 overflow-x-auto border-b border-border text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Aspecto de una pestaña: el de un disparador de Radix (activo con `data-state`) y el de un enlace
 * que navega entre páginas hermanas (activo con `aria-current="page"`), para que las dos se vean
 * igual.
 */
export const tabTriggerClassName = cn(
  "relative inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-t-md px-3 text-sm font-medium whitespace-nowrap text-foreground-muted transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 max-md:h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity data-active:text-primary data-active:after:opacity-100 aria-[current=page]:text-primary aria-[current=page]:after:opacity-100",
);

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabTriggerClassName, className)}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex flex-col gap-6 outline-none", className)}
      {...props}
    />
  );
}

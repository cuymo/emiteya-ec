// Derivado de la plantilla «Studio Admin» 2.2.0, `src/components/ui/kbd.tsx` (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Sin cambios de comportamiento: indica un atajo junto a un control
// que ya tiene su nombre accesible, así que se oculta a las tecnologías de asistencia.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      aria-hidden="true"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none",
        "in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10",
        "[&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

// Derivado de la plantilla «Studio Admin» 2.2.0, `src/components/ui/skeleton.tsx` (MIT;
// frontend/THIRD_PARTY_NOTICES.md). Adaptado (adopt-premium-design-foundation-and-shell, design D6):
// el pulso solo con movimiento permitido y oculto a las tecnologías de asistencia, que reciben el
// estado de carga de un `role="status"` de quien lo usa. Es el único esqueleto: `states.tsx` lo
// reexporta.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

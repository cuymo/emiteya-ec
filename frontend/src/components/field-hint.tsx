// La ayuda de un campo, junto a su etiqueta (decisión del propietario, 2026-10-22): un ícono de
// exclamación que muestra el texto en un tooltip al pasar el ratón, con el foco del teclado o al
// tocarlo en un teléfono, en lugar del texto pequeño debajo del campo. El texto sigue en el
// documento, oculto a la vista, con el `id` que el control nombra en `aria-describedby`: un lector de
// pantalla lo lee al llegar al campo, sin abrir el tooltip.
"use client";

import { CircleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function FieldHint({
  id,
  label,
  className,
  children,
}: {
  /** El `id` del texto, el que el control nombra en `aria-describedby`. */
  id?: string;
  /** La etiqueta del campo, para nombrar el botón: «Ayuda: Identificación». */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span id={id} className="sr-only">
        {children}
      </span>
      {/* Su propio proveedor: la ayuda funciona también en un campo fuera del shell. */}
      <TooltipProvider delayDuration={150}>
        <Tooltip open={open} onOpenChange={setOpen}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`Ayuda: ${label}`}
              data-slot="field-hint"
              // Un toque en el teléfono no pasa el ratón: abre el tooltip. Sin el comportamiento de
              // Radix, que lo cerraría con el mismo clic.
              onClick={(event) => {
                event.preventDefault();
                setOpen(true);
              }}
              className={cn(
                "relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-foreground-muted hover:text-foreground focus-visible:text-foreground",
                "after:absolute after:-inset-2 max-md:after:-inset-3.5",
                className,
              )}
            >
              <CircleAlert aria-hidden="true" className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-pretty">
            {children}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
}

/** Una etiqueta con su ayuda a la derecha, para los campos que no usan `FormField`. */
export function LabelWithHint({
  hint,
  hintId,
  label,
  children,
}: {
  hint?: ReactNode;
  hintId?: string;
  /** El nombre del campo para el botón de la ayuda. */
  label: string;
  /** La etiqueta tal como se pinta: un `<label>`, un `<span>` con su `id`, o un `<legend>`. */
  children: ReactNode;
}) {
  if (!hint) return <>{children}</>;
  return (
    <div className="flex items-center gap-1.5">
      {children}
      <FieldHint {...(hintId ? { id: hintId } : {})} label={label}>
        {hint}
      </FieldHint>
    </div>
  );
}

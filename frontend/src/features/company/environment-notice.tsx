// Indicador del ambiente en la barra superior (ERS RF-004 y RF-005;
// productize-invoice-editor-and-composition-foundation, design D21). Es el aviso persistente del
// ambiente: compacto, a todas las anchuras, sigue a la vista al desplazar porque la barra es fija, no
// se puede cerrar ni ocultar, y nunca comunica solo con color o icono. Ya no hay franja de ancho
// completo: la advertencia fiscal se repite donde se decide, junto a «Emitir»
// (`EmissionEnvironmentNotice`).
// - Pruebas: «Pruebas» con advertencia; su nombre accesible dice que los comprobantes no tienen
//   validez tributaria, y lo explica al enfocarlo con el teclado, al señalarlo o al tocarlo.
// - Producción: contexto, no un resultado; neutro y de alta atención, sin el verde de éxito.
// - Sin confirmar: lo dice y lo explica, y nunca se presenta como Producción.
// Mientras carga se reserva el espacio.
"use client";

import { Radio, TriangleAlert } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useEnvironmentState } from "./company-api";

export function EnvironmentIndicator() {
  const environment = useEnvironmentState();
  if (environment === "PENDING") return <Skeleton className="h-5 w-20 shrink-0 rounded-4xl" />;
  if (environment === "UNKNOWN") {
    return (
      <ExplainedIndicator
        label="Sin confirmar"
        name="Ambiente sin confirmar: no pudimos confirmar el ambiente"
        title="No pudimos confirmar el ambiente"
      >
        No sabemos si los comprobantes que se emitan tendrán validez tributaria. Vuelve a cargar la
        pantalla antes de emitir.
      </ExplainedIndicator>
    );
  }
  if (environment === "PRODUCTION") {
    return (
      <Badge variant="emphasis" data-slot="environment-indicator">
        <Radio aria-hidden="true" />
        <span className="sr-only">Ambiente de </span>
        <span>Producción</span>
      </Badge>
    );
  }
  return (
    <ExplainedIndicator
      label="Pruebas"
      name="Ambiente de Pruebas: los comprobantes no tienen validez tributaria"
      title="Ambiente de Pruebas"
    >
      Los comprobantes que se emiten en Pruebas no tienen validez tributaria. Un administrador
      cambia el ambiente en Configuración › Ambiente.
    </ExplainedIndicator>
  );
}

/**
 * Botón con popover, no un tooltip, para que la explicación llegue también con el tacto y el
 * teclado (design D21). Se abre al tocarlo o pulsarlo, al señalarlo con el ratón y al llegar a él
 * con el teclado; el foco se queda en el botón, porque el contenido solo explica.
 */
function ExplainedIndicator({
  label,
  name,
  title,
  children,
}: {
  label: string;
  name: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Cómo se abrió: lo que lo abre al pasar o al enfocar lo cierra al salir; un clic lo fija.
  const openedBy = useRef<"hover" | "focus" | "click" | null>(null);
  const pointerDown = useRef(false);
  const show = (by: "hover" | "focus" | "click") => {
    openedBy.current = by;
    setOpen(true);
  };
  const hide = (by: "hover" | "focus") => {
    if (openedBy.current !== by) return;
    openedBy.current = null;
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        openedBy.current = next ? "click" : null;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={name}
          data-slot="environment-indicator"
          className={cn(
            badgeVariants({ variant: "warning" }),
            // 20 px visibles, con un área táctil de 44 px en móvil (20 + 2 × 12).
            "relative cursor-default overflow-visible max-md:after:absolute max-md:after:-inset-3",
          )}
          onPointerDown={() => {
            pointerDown.current = true;
          }}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") show("hover");
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") hide("hover");
          }}
          onFocus={() => {
            // Solo el foco del teclado lo abre; el de un clic lo gestiona el propio clic.
            if (!pointerDown.current) show("focus");
            pointerDown.current = false;
          }}
          onBlur={() => hide("focus")}
          onClick={(event) => {
            // Abierto al pasar o al enfocar: el clic lo fija en lugar de cerrarlo.
            if (open && openedBy.current !== "click") {
              event.preventDefault();
              openedBy.current = "click";
            }
          }}
        >
          <TriangleAlert aria-hidden="true" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={title}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </PopoverContent>
    </Popover>
  );
}

// Paleta de comandos (adopt-premium-design-foundation-and-shell, design D13; spec
// web-application-shell, «Paleta de comandos»). Derivada de `search-dialog.tsx` de la plantilla
// «Studio Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md): se abre con Ctrl/⌘ + K (en la plantilla era
// ⌘J) o con su disparador, y solo ofrece navegación y creación rápida. El disparador declara ese
// alcance, «Buscar pantalla o acción» (design D26): no promete buscar registros. En la barra superior
// es un botón con la lupa, «Buscar» y el atajo (en un teléfono, solo la lupa), con ese nombre
// accesible y esa ayuda. El contenido se
// carga bajo demanda la primera vez que se abre, para no engordar la carga inicial de cada pantalla.
"use client";

import { Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useModifierLabel } from "./shortcut";

const SCOPE = "Buscar pantalla o acción";

const CommandPaletteDialog = dynamic(() => import("./command-palette-dialog"), { ssr: false });

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const modifier = useModifierLabel();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setLoaded(true);
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const show = () => {
    setLoaded(true);
    setOpen(true);
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={SCOPE}
            aria-keyshortcuts="Control+K Meta+K"
            onClick={show}
            className="h-9 gap-2 rounded-lg px-3 text-foreground-muted max-md:size-11 max-md:px-0"
          >
            <Search aria-hidden="true" />
            <span className="max-md:hidden">Buscar</span>
            <Kbd className="max-md:hidden">{modifier} K</Kbd>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{SCOPE}</TooltipContent>
      </Tooltip>
      {loaded && <CommandPaletteDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

// Paleta de comandos (adopt-premium-design-foundation-and-shell, design D13; spec
// web-application-shell, «Paleta de comandos»). Derivada de `search-dialog.tsx` de la plantilla
// «Studio Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md): se abre con Ctrl/⌘ + K (en la plantilla era
// ⌘J) o con su disparador, y solo ofrece navegación y creación rápida. El disparador declara ese
// alcance, «Buscar pantalla o acción» (design D26): no promete buscar registros. Es un botón redondo
// de la barra superior, con ese nombre y una ayuda con el atajo. El contenido se
// carga bajo demanda la primera vez que se abre, para no engordar la carga inicial de cada pantalla.
"use client";

import { Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useModifierLabel } from "./shortcut";
import { TOPBAR_ACTION } from "./topbar";

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
            variant="ghost"
            size="icon"
            aria-label={SCOPE}
            aria-keyshortcuts="Control+K Meta+K"
            onClick={show}
            className={TOPBAR_ACTION}
          >
            <Search aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {SCOPE} <Kbd>{modifier} K</Kbd>
        </TooltipContent>
      </Tooltip>
      {loaded && <CommandPaletteDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

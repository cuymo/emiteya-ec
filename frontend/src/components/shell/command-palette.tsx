// Paleta de comandos (adopt-premium-design-foundation-and-shell, design D13; spec
// web-application-shell, «Paleta de comandos»). Derivada de `search-dialog.tsx` de la plantilla
// «Studio Admin» (MIT; frontend/THIRD_PARTY_NOTICES.md): se abre con Ctrl/⌘ + K (en la plantilla era
// ⌘J) o con su disparador, y solo ofrece navegación y creación rápida. El contenido se carga bajo
// demanda la primera vez que se abre, para no engordar la carga inicial de cada pantalla.
"use client";

import { Search } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useModifierLabel } from "./shortcut";

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
      <Button
        variant="outline"
        size="sm"
        aria-label="Buscar"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={show}
        className="hidden w-48 justify-start text-muted-foreground lg:inline-flex"
      >
        <Search aria-hidden="true" />
        <span className="flex-1 text-left">Buscar…</span>
        <Kbd>{modifier} K</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Buscar"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={show}
        className="lg:hidden"
      >
        <Search aria-hidden="true" />
      </Button>
      {loaded && <CommandPaletteDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

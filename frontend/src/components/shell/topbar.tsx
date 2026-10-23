// Barra superior del shell (adopt-premium-design-foundation-and-shell, design D11). Derivada de la
// cabecera de `src/app/(main)/dashboard/layout.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), sin preferencias de diseño, preajustes, menú de GitHub ni cuentas
// de demostración. Composición pedida por el propietario: encima, a todo el ancho, el aviso del
// ambiente cuando lo hay; debajo, una sola línea a todas las anchuras:
// - izquierda: la navegación, el título de la pantalla y sus migas;
// - derecha: la paleta, la pantalla completa, los avisos (decisión del propietario, 2026-10-22) y la
//   identidad: la empresa de la sesión y, debajo, la cuenta, que abre su menú.
// Sin tema, que vive en el menú de cuenta. El botón que abre el panel móvil usa el icono de menú,
// «Abrir navegación» (adopt-premium-design-foundation-and-shell, design D29).
"use client";

import { Maximize, Menu, Minimize } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountMenu } from "./account-menu";
import { TopbarHeading } from "./app-breadcrumbs";
import { useModifierLabel } from "./shortcut";

/** Clase de las acciones globales: un botón redondo sobre el gris del tema. */
export const TOPBAR_ACTION = "rounded-full bg-muted text-foreground-muted hover:bg-accent";

function SidebarToggle() {
  const { isMobile, open, openMobile } = useSidebar();
  const modifier = useModifierLabel();
  if (isMobile) {
    return (
      <SidebarTrigger
        aria-label="Abrir navegación"
        aria-haspopup="dialog"
        aria-expanded={openMobile}
        size="icon-sm"
      >
        <Menu aria-hidden="true" />
      </SidebarTrigger>
    );
  }
  const label = open ? "Contraer barra lateral" : "Expandir barra lateral";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarTrigger aria-label={label} aria-expanded={open} size="icon-sm" />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} <Kbd>{modifier} B</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}

const subscribeFullscreen = (onChange: () => void) => {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
};
const subscribeNever = () => () => {};

/** Pantalla completa del navegador, solo si el navegador la permite. */
function FullscreenToggle() {
  const supported = useSyncExternalStore(
    subscribeNever,
    () => document.fullscreenEnabled,
    () => false,
  );
  const active = useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  );
  if (!supported) return null;
  const label = active ? "Salir de pantalla completa" : "Pantalla completa";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          className={`${TOPBAR_ACTION} max-md:hidden`}
          onClick={() =>
            void (active ? document.exitFullscreen() : document.documentElement.requestFullscreen())
          }
        >
          {active ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Topbar({
  company,
  environment,
  search,
  notifications,
}: {
  company: ReactNode;
  environment: ReactNode;
  search?: ReactNode;
  /** La campana de avisos, a la izquierda de la identidad. */
  notifications?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-(--z-sticky) flex shrink-0 flex-col border-b bg-background">
      {environment}
      <div
        data-slot="topbar-row"
        className="flex h-14 items-center justify-between gap-4 px-3 md:h-18 md:px-6"
      >
        <div data-slot="topbar-start" className="flex min-w-0 flex-1 items-center gap-3">
          <SidebarToggle />
          <Separator
            orientation="vertical"
            className="hidden data-vertical:h-8 data-vertical:self-center md:block"
          />
          <TopbarHeading />
        </div>
        <div data-slot="topbar-end" className="flex shrink-0 items-center gap-2 md:gap-3">
          {search}
          <FullscreenToggle />
          {notifications}
          {/* Toda la identidad abre el menú de cuenta (decisión del propietario, 2026-10-22). */}
          <AccountMenu company={company} />
        </div>
      </div>
    </header>
  );
}

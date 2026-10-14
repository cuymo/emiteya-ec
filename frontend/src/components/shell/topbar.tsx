// Barra superior del shell (adopt-premium-design-foundation-and-shell, design D11). Derivada de la
// cabecera de `src/app/(main)/dashboard/layout.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), sin preferencias de diseño, preajustes, menú de GitHub ni cuentas
// de demostración. Por anchura:
// - desde 768 px: alternar la barra, migas, contexto de la empresa, paleta, ambiente, tema y cuenta;
// - en móvil: navegación, contexto de la empresa (que crece), ambiente, paleta y cuenta; las migas
//   pasan al contenido. El ambiente se ve a todas las anchuras (design D27), y el botón que abre el
//   panel móvil usa el icono de menú, «Abrir navegación» (design D29).
"use client";

import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountMenu } from "./account-menu";
import { AppBreadcrumbs } from "./app-breadcrumbs";
import { useModifierLabel } from "./shortcut";

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

export function Topbar({
  company,
  environment,
  search,
}: {
  company: ReactNode;
  environment: ReactNode;
  search?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-(--z-sticky) flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 max-md:h-14 md:px-4">
      <SidebarToggle />
      <Separator
        orientation="vertical"
        className="hidden data-vertical:h-4 data-vertical:self-center md:block"
      />
      {/* Ocupa el espacio central aunque no haya migas, para que el resto quede a la derecha. */}
      <div className="hidden min-w-0 flex-1 md:flex">
        <AppBreadcrumbs />
      </div>
      <div className="flex min-w-0 items-center max-md:flex-1 md:max-w-64">{company}</div>
      {search}
      {environment}
      <ThemeToggle />
      <AccountMenu />
    </header>
  );
}

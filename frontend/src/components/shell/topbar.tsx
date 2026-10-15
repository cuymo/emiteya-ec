// Barra superior del shell (adopt-premium-design-foundation-and-shell, design D11). Derivada de la
// cabecera de `src/app/(main)/dashboard/layout.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), sin preferencias de diseño, preajustes, menú de GitHub ni cuentas
// de demostración. Solo el contexto global, en una sola línea a todas las anchuras y en tres zonas
// (productize-invoice-editor-and-composition-foundation, design D1):
// - izquierda: la navegación y el contexto de la empresa, acotado y recortado;
// - centro flexible: el acceso a la paleta;
// - derecha: el ambiente y la cuenta.
// 8 px dentro de cada zona y 16 px entre zonas. Sin migas, que van encima del título (D2), y sin
// tema, que vive en el menú de cuenta. El botón que abre el panel móvil usa el icono de menú,
// «Abrir navegación» (adopt-premium-design-foundation-and-shell, design D29).
"use client";

import { Menu } from "lucide-react";
import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountMenu } from "./account-menu";
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
    <header className="sticky top-0 z-(--z-sticky) flex h-12 shrink-0 items-center gap-4 border-b bg-background px-3 max-md:h-14 md:px-4">
      <div data-slot="topbar-start" className="flex min-w-0 items-center gap-2 max-md:flex-1">
        <SidebarToggle />
        <Separator
          orientation="vertical"
          className="hidden data-vertical:h-4 data-vertical:self-center md:block"
        />
        <div className="flex max-w-40 min-w-0 items-center md:max-w-56">{company}</div>
      </div>
      <div data-slot="topbar-center" className="flex min-w-0 justify-center md:flex-1">
        {search}
      </div>
      <div data-slot="topbar-end" className="flex shrink-0 items-center gap-2">
        {environment}
        <AccountMenu />
      </div>
    </header>
  );
}

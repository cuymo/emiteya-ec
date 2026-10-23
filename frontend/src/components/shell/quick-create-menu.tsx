// Creación rápida (adopt-premium-design-foundation-and-shell, design D14; spec web-application-shell,
// «Creación rápida»). Derivada del «Quick Create» de `nav-main.tsx` de la plantilla «Studio Admin»
// (MIT; frontend/THIRD_PARTY_NOTICES.md), con comportamiento real: un menú con las pantallas de
// creación existentes que el rol permite. Solo navega; nunca crea un borrador, reserva un número ni
// emite. Lleva un degradado azul discreto, no el relleno del primario (decisión del propietario,
// 2026-10-23).
"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/components/session";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { permissionsOf, visibleCreateActions } from "@/lib/navigation/routes";
import { cn } from "@/lib/utils";

export function QuickCreateMenu() {
  const { me } = useSession();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const actions = visibleCreateActions(permissionsOf(me.role));
  if (actions.length === 0) return null;
  const collapsed = state === "collapsed" && !isMobile;

  // Con un degradado azul discreto en lugar del relleno sólido, del alto y el ancho de los items
  // de la barra y con el texto centrado (decisiones del propietario, 2026-10-22 y 2026-10-23).
  const gradient = cn(
    "border-primary/30 bg-linear-to-r from-primary/20 via-primary/10 to-primary/5 text-primary",
    "hover:bg-transparent hover:from-primary/30 hover:via-primary/15 hover:to-primary/10 hover:text-primary",
    "aria-expanded:bg-transparent aria-expanded:text-primary",
  );
  const trigger = collapsed ? (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Nuevo"
      className={cn(gradient, "self-center")}
    >
      <Plus aria-hidden="true" />
    </Button>
  ) : (
    <Button variant="ghost" size="sm" className={cn(gradient, "w-full justify-center")}>
      <Plus aria-hidden="true" data-icon="inline-start" />
      Nuevo
    </Button>
  );

  return (
    <DropdownMenu>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Nuevo</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="start" side={collapsed ? "right" : "bottom"} className="min-w-56">
        {actions.map(({ id, label, href, icon: Icon }) => (
          <DropdownMenuItem key={id} asChild>
            <Link
              href={href}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
              }}
            >
              <Icon aria-hidden="true" />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

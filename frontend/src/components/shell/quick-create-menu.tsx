// Creación rápida (adopt-premium-design-foundation-and-shell, design D14; spec web-application-shell,
// «Creación rápida»). Derivada del «Quick Create» de `nav-main.tsx` de la plantilla «Studio Admin»
// (MIT; frontend/THIRD_PARTY_NOTICES.md), con comportamiento real: un menú con las pantallas de
// creación existentes que el rol permite. Solo navega; nunca crea un borrador, reserva un número ni
// emite. Usa la variante `outline`: está en todas las pantallas y no compite con su acción principal.
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

export function QuickCreateMenu() {
  const { me } = useSession();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const actions = visibleCreateActions(permissionsOf(me.role));
  if (actions.length === 0) return null;
  const collapsed = state === "collapsed" && !isMobile;

  const trigger = collapsed ? (
    <Button variant="outline" size="icon-sm" aria-label="Nuevo" className="self-center">
      <Plus aria-hidden="true" />
    </Button>
  ) : (
    <Button variant="outline" size="sm" className="w-full justify-start">
      <Plus aria-hidden="true" />
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

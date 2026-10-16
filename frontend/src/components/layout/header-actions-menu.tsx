// Más acciones de una pantalla de detalle (decisión del propietario, 2026-10-16): un botón «⋯» al
// final del título que despliega las acciones secundarias, como crear otro comprobante desde este,
// en lugar de una fila de botones junto al encabezado. La acción principal de la pantalla, si la
// hay, sigue a la vista. Composición del menú de acciones de las filas (`RowActionsMenu`): el botón
// nombra el registro, una acción no disponible se ve como tal y dice por qué, y el menú devuelve el
// foco al botón al cerrarse.
"use client";

import { LoaderCircle, MoreHorizontal, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type HeaderAction = {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** Un destino, o una acción al elegirla. */
  href?: string;
  onSelect?: () => void;
  /** Visible pero no disponible, con su motivo. */
  disabled?: boolean;
  hint?: string;
};

export function HeaderActionsMenu({
  label,
  actions,
  busy = false,
}: {
  /** Nombre accesible del botón, con el registro: «Más acciones de la factura 001-001-…». */
  label: string;
  actions: readonly HeaderAction[];
  /** Una acción del menú está en curso. */
  busy?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  if (actions.length === 0) return null;
  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip open={hintOpen && !menuOpen} onOpenChange={setHintOpen}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              aria-busy={busy || undefined}
              data-slot="header-actions-menu"
              className="shrink-0 text-foreground-muted"
            >
              {busy ? (
                <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
              ) : (
                <MoreHorizontal aria-hidden="true" />
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Más acciones</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-56">
        {actions.map((action) => {
          const Icon = action.icon;
          const content = (
            <>
              {Icon && <Icon aria-hidden="true" />}
              <span className="flex flex-col gap-0.5">
                {action.label}
                {action.disabled && action.hint && (
                  <span className="text-xs text-muted-foreground">{action.hint}</span>
                )}
              </span>
            </>
          );
          if (action.href && !action.disabled) {
            return (
              <DropdownMenuItem key={action.key} asChild>
                <Link href={action.href}>{content}</Link>
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem
              key={action.key}
              disabled={action.disabled}
              {...(action.onSelect ? { onSelect: action.onSelect } : {})}
            >
              {content}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Menú de acciones de una fila (productize-invoice-list-and-shared-table-foundation, design D11;
// cognitive-architecture.md, «Action Budget»). Adaptado de la celda de acciones de
// `src/app/(main)/dashboard/users/_components/users-columns.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md): el botón siempre lleva un nombre que identifica el registro
// (en Roles de la plantilla no lo tiene) y su ayuda. El módulo pasa solo las acciones que el estado
// y el rol permiten; el menú devuelve el foco al botón al cerrarse.
"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type RowAction =
  | { key: string; label: string; icon?: LucideIcon; href: string }
  | { key: string; label: string; icon?: LucideIcon; onSelect: () => void };

export function RowActionsMenu({
  label,
  actions,
}: {
  /** Nombre accesible del botón, con el registro: «Acciones de la factura 001-001-…». */
  label: string;
  actions: readonly RowAction[];
}) {
  if (actions.length === 0) return null;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              className="text-muted-foreground"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Acciones</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-44">
        {actions.map((action) => {
          const Icon = action.icon;
          const content = (
            <>
              {Icon && <Icon aria-hidden="true" />}
              {action.label}
            </>
          );
          return "href" in action ? (
            <DropdownMenuItem key={action.key} asChild>
              <Link href={action.href}>{content}</Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={action.key} onSelect={action.onSelect}>
              {content}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Menú de acciones de una fila (productize-invoice-list-and-shared-table-foundation, design D11;
// cognitive-architecture.md, «Action Budget»). Adaptado de la celda de acciones de
// `src/app/(main)/dashboard/users/_components/users-columns.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md): el botón siempre lleva un nombre que identifica el registro
// (en Roles de la plantilla no lo tiene) y su ayuda. El módulo pasa solo las acciones que el estado
// y el rol permiten; el menú devuelve el foco al botón al cerrarse. Con `trigger="labeled"` el
// botón dice «Acciones» con borde, para las tablas donde un ícono suelto pasa desapercibido
// (decisión del propietario, 2026-10-16: Usuarios).
"use client";

import { ChevronDown, MoreHorizontal, type LucideIcon } from "lucide-react";
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

export type RowAction =
  | { key: string; label: string; icon?: LucideIcon; href: string }
  | { key: string; label: string; icon?: LucideIcon; onSelect: () => void };

export function RowActionsMenu({
  label,
  actions,
  trigger = "icon",
  disabled = false,
}: {
  /** Nombre accesible del botón, con el registro: «Acciones de la factura 001-001-…». */
  label: string;
  actions: readonly RowAction[];
  /** «⋯» discreto (por defecto) o un botón con borde que dice «Acciones». */
  trigger?: "icon" | "labeled";
  /** Mientras una acción de la fila está en curso. */
  disabled?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  if (actions.length === 0) return null;
  if (trigger === "labeled") {
    return (
      <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          {/* El nombre visible encabeza el accesible: «Acciones de Ana Pérez». */}
          <Button variant="outline" size="sm" aria-label={label} disabled={disabled}>
            Acciones
            <ChevronDown aria-hidden="true" data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <RowActionsContent actions={actions} />
      </DropdownMenu>
    );
  }
  return (
    // No modal: no oculta el resto de la página con aria-hidden ni bloquea el desplazamiento; el
    // foco entra al menú, Escape lo devuelve al botón y salir del menú lo cierra. La ayuda se oculta
    // mientras el menú está abierto, para que no lo tape al abrirlo con el teclado.
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip open={hintOpen && !menuOpen} onOpenChange={setHintOpen}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              // En la fila mide 32 px también en móvil, con 44 px de objetivo táctil: así la tabla
              // compacta cabe a 390 px.
              className="relative text-muted-foreground max-md:size-8 max-md:after:absolute max-md:after:-inset-1.5"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Acciones</TooltipContent>
      </Tooltip>
      <RowActionsContent actions={actions} />
    </DropdownMenu>
  );
}

function RowActionsContent({ actions }: { actions: readonly RowAction[] }) {
  return (
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
  );
}

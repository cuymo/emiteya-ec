// Los borradores dentro de la lista de su tipo (unify-drafts-into-document-lists, design D5): el
// filtro «Borradores» (`?estado=borradores`), la fecha de su última edición y las acciones de la
// fila, iguales en las seis listas de comprobantes. Cada lista pone su editor y su eliminación.
"use client";

import { PencilLine, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { RowAction } from "@/components/data-table/row-actions-menu";
import { MutedCell } from "@/components/data-table/data-table-cells";
import { formatDateTime } from "@/features/invoices/invoice-format";

/** El valor de `estado` en la dirección que deja solo los borradores. */
export const DRAFT_STATE_PARAM = "borradores";
export const DRAFT_FILTER_LABEL = "Borradores";

/** «Editado 12/10/2026, 10:30»: cuándo se tocó por última vez el borrador. */
export function DraftEditedAt({ updatedAt }: { updatedAt: string }) {
  return <MutedCell className="whitespace-nowrap">Editado {formatDateTime(updatedAt)}</MutedCell>;
}

/** «Continuar» abre su editor y «Eliminar borrador» pide confirmación. */
export function draftRowActions({
  editHref,
  onDelete,
}: {
  editHref: string;
  onDelete?: (() => void) | undefined;
}): RowAction[] {
  return [
    { key: "continuar", label: "Continuar", icon: PencilLine, href: editHref },
    ...(onDelete
      ? [{ key: "eliminar", label: "Eliminar borrador", icon: Trash2, onSelect: onDelete }]
      : []),
  ];
}

/** El tercero de un borrador, o lo que le falta, atenuado. */
export function DraftParty({ name, missing }: { name: string | null; missing: string }): ReactNode {
  return name ? (
    <span className="font-medium break-words">{name}</span>
  ) : (
    <MutedCell>{missing}</MutedCell>
  );
}

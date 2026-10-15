// Estados de la superficie de la tabla compartida (productize-invoice-list-and-shared-table-
// foundation, design D14; feedback-and-states.md): vacío, vacío por filtros y error ocupan el lugar
// de las filas, con un encabezado de nivel 2, una explicación breve y, si existe, una acción. Sobre
// `ui/empty` (derivado de la plantilla); la plantilla solo muestra «No results.» en una fila.
"use client";

import { RotateCcw, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function DataTableEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Empty className="min-h-56 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle asChild>
          <h2>{title}</h2>
        </EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/** Error al cargar: mantiene la superficie y ofrece reintentar, sin detalles técnicos. */
export function DataTableError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert">
      <DataTableEmpty
        icon={RotateCcw}
        title={message}
        description="Revisa tu conexión e inténtalo de nuevo."
        action={
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            Intentar de nuevo
          </Button>
        }
      />
    </div>
  );
}

// Filtros activos de la tabla compartida (productize-invoice-list-and-shared-table-foundation,
// design D5; data-tables.md y cognitive-architecture.md): cada filtro activo se ve y se quita uno a
// uno, y «Limpiar filtros» aparece solo si hay alguno activo. La plantilla no tiene esta pieza.
"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ActiveFilter = { key: string; label: string; onRemove: () => void };

export function DataTableActiveFilters({
  filters,
  active,
  onClear,
}: {
  /** Filtros que no se ven en otro control (la búsqueda y las opciones del menú). */
  filters: readonly ActiveFilter[];
  /** Hay algún filtro activo, también una vista distinta de la general. */
  active: boolean;
  onClear: () => void;
}) {
  if (!active) return null;
  return (
    <div role="group" aria-label="Filtros activos" className="flex flex-wrap items-center gap-1.5">
      {filters.map((filter) => (
        <Badge key={filter.key} variant="outline" className="h-7 gap-1 pr-0.5 pl-2.5 text-sm">
          {filter.label}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Quitar filtro ${filter.label}`}
            onClick={filter.onRemove}
          >
            <X aria-hidden="true" />
          </Button>
        </Badge>
      ))}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Limpiar filtros
      </Button>
    </div>
  );
}

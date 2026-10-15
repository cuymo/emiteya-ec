// Vistas de una lista (productize-invoice-list-and-shared-table-foundation, design D6): lentes sobre
// la misma colección (navigation-responsive.md), como las vistas «All / Needs action» de
// `src/app/(main)/dashboard/ecommerce/_components/recent-orders.tsx` de la plantilla «Studio Admin»
// (MIT; frontend/THIRD_PARTY_NOTICES.md). Grupo de radio de selección única que se recorre con las
// flechas, siempre con una vista elegida, con selección neutra y un conteo opcional que viene del
// servidor.
"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type DataTableView<T extends string> = {
  value: T;
  label: string;
  /** Número de registros de la vista según el servidor; sin conteo, no se muestra. */
  count?: number;
};

export function DataTableViews<T extends string>({
  label,
  value,
  views,
  onChange,
}: {
  label: string;
  value: T;
  views: readonly DataTableView<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      className="w-full sm:w-fit"
    >
      {views.map((view) => (
        <ToggleGroupItem key={view.value} value={view.value} className="flex-auto sm:flex-none">
          {view.label}
          {/* El espacio separa el conteo en el nombre accesible: «Requiere atención 3». */}
          {view.count !== undefined && " "}
          {view.count !== undefined && (
            <span
              className={cn(
                "min-w-5 rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums",
                "group-data-[state=on]/toggle:bg-background group-data-[state=on]/toggle:text-foreground",
              )}
            >
              {view.count.toLocaleString("es-EC")}
            </span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

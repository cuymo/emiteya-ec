// Filtro de una lista como desplegable con prefijo («Estado: Todos»). Portado de los filtros de
// `src/app/(main)/dashboard/users/_components/users.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), sobre el selector de lista de Radix (`ui/select-menu`).
// - Sustituye a los chips, a las vistas y al filtro de opción: un solo control para elegir un valor.
// - Con `allLabel`, la primera opción quita el filtro (`undefined`); sin él, las opciones ya
//   incluyen la que lo deshace, como «Todos».
// - El disparador se llama como el filtro («Estado»), y su valor se lee de su contenido: un
//   `combobox` no toma el nombre de su texto.
// - Una opción puede llevar un número que viene del servidor, como «Requiere atención 3».
"use client";

import type { LucideIcon } from "lucide-react";
import {
  SelectMenu,
  SelectMenuContent,
  SelectMenuGroup,
  SelectMenuItem,
  SelectMenuTrigger,
  SelectMenuValue,
} from "@/components/ui/select-menu";

export type SelectFilterOption<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Número de registros según el servidor; sin número, no se muestra. */
  count?: number;
};

/** Valor interno de la opción que quita el filtro: Radix no admite un valor vacío. */
const ALL = "__todos__";

export function DataTableSelectFilter<T extends string>({
  label,
  value,
  options,
  onChange,
  allLabel,
  align = "start",
}: {
  label: string;
  value: T | undefined;
  options: readonly SelectFilterOption<T>[];
  onChange: (value: T | undefined) => void;
  allLabel?: string;
  align?: "start" | "end";
}) {
  return (
    <SelectMenu
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? undefined : (next as T))}
    >
      <SelectMenuTrigger
        size="sm"
        aria-label={label}
        className="max-md:w-full max-md:justify-start"
      >
        <span aria-hidden="true" className="text-muted-foreground">
          {label}:
        </span>
        {/* En un teléfono el control ocupa la fila: el valor sigue a su prefijo y el icono va al final. */}
        <SelectMenuValue className="text-left" />
      </SelectMenuTrigger>
      <SelectMenuContent align={align}>
        <SelectMenuGroup>
          {allLabel && <SelectMenuItem value={ALL}>{allLabel}</SelectMenuItem>}
          {options.map((option) => (
            <SelectMenuItem key={option.value} value={option.value}>
              {option.icon && <option.icon aria-hidden="true" />}
              {option.label}
              {/* El espacio separa el número en el nombre accesible: «Requiere atención 3». */}
              {option.count !== undefined && " "}
              {option.count !== undefined && (
                <span className="min-w-5 rounded-full bg-muted px-1.5 text-center text-xs text-muted-foreground tabular-nums">
                  {option.count.toLocaleString("es-EC")}
                </span>
              )}
            </SelectMenuItem>
          ))}
        </SelectMenuGroup>
      </SelectMenuContent>
    </SelectMenu>
  );
}

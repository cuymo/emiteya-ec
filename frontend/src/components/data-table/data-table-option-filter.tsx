// Filtro de opción única de la tabla compartida (productize-invoice-list-and-shared-table-
// foundation, design D6). Adaptado del filtro de estado de
// `src/app/(main)/dashboard/tasks/_components/task-status-filter.tsx` de la plantilla «Studio Admin»
// (MIT; frontend/THIRD_PARTY_NOTICES.md): la plantilla elige varias opciones en el cliente; aquí se
// elige una, porque el servidor acepta un solo valor por consulta, y la selección es neutra. El
// disparador dice el filtro y su valor («Estado: Devuelto»), y el menú ofrece quitarlo.
"use client";

import { ChevronDown, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FilterOption<T extends string> = { value: T; label: string; icon?: LucideIcon };

export function DataTableOptionFilter<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly FilterOption<T>[];
  onChange: (value: T | undefined) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    // No modal, como el menú de la fila: la página no queda oculta con aria-hidden mientras se elige.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "w-full justify-between sm:w-fit",
            selected ? "bg-muted text-foreground" : "border-dashed text-muted-foreground",
          )}
        >
          {selected ? `${label}: ${selected.label}` : label}
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(next) => onChange(next === "" ? undefined : (next as T))}
        >
          {options.map(({ value: option, label: text, icon: Icon }) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {Icon && <Icon aria-hidden="true" />}
              {text}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {selected && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(undefined)}>
              <X aria-hidden="true" />
              Quitar filtro
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

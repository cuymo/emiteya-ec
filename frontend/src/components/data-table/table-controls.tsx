// Controles compartidos de tabla (component-system.md): búsqueda con limpieza, chips de filtro,
// menú de columnas opcionales y botón de acción de fila con tooltip.
"use client";

import { Columns3, Search, X, type LucideIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuTrigger,
  Tooltip,
} from "@/components/ui/menu-and-tooltip";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <div className="relative w-full sm:w-32">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1 size-2 -translate-y-1/2 text-foreground-muted"
      />
      <Input
        type="search"
        inputMode="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="pr-5 pl-4"
      />
      {value && (
        <button
          type="button"
          aria-label="Limpiar búsqueda"
          onClick={() => onChange("")}
          className="absolute inset-y-0 right-0 inline-flex w-5 items-center justify-center text-foreground-muted hover:text-foreground"
        >
          <X aria-hidden="true" className="size-2" />
        </button>
      )}
    </div>
  );
}

/** Chips de filtro de selección única: siempre hay una opción activa. */
export function ChipGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as T);
      }}
      className="flex flex-wrap gap-0.5"
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            "h-4 rounded-full border border-border px-1.5 text-sm text-foreground max-md:h-5.5",
            "motion-safe:transition-colors motion-safe:duration-150",
            "hover:bg-surface-subtle data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function ColumnVisibilityMenu({
  columns,
  visibility,
  onChange,
}: {
  columns: readonly { id: string; label: string }[];
  visibility: Record<string, boolean>;
  onChange: (id: string, visible: boolean) => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="outline">
          <Columns3 aria-hidden="true" />
          Columnas
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {columns.map((column) => (
          <MenuCheckboxItem
            key={column.id}
            checked={visibility[column.id] ?? false}
            onCheckedChange={(checked) => onChange(column.id, checked)}
            onSelect={(event) => event.preventDefault()}
          >
            {column.label}
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export function RowActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="max-md:size-5.5"
      >
        <Icon aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}

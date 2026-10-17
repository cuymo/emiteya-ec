// Controles compartidos de tabla (component-system.md): búsqueda con limpieza, menú de columnas
// opcionales y botón o enlace de acción de fila con tooltip. Los filtros son `DataTableSelectFilter`.
"use client";

import { Columns3, Search, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuTrigger,
  Tooltip,
} from "@/components/ui/menu-and-tooltip";

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
    <div className="relative w-full sm:w-64">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-foreground-muted"
      />
      <Input
        type="search"
        inputMode="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-lg pr-10 pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Limpiar búsqueda"
          onClick={() => onChange("")}
          className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center text-foreground-muted hover:text-foreground"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
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
        size="legacy-icon-sm"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className="max-md:size-11"
      >
        <Icon aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}

/** Como `RowActionButton`, para una acción que lleva a otra página, como corregir el registro. */
export function RowActionLink({
  icon: Icon,
  label,
  href,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
}) {
  return (
    <Tooltip label={label}>
      <Button variant="ghost" size="legacy-icon-sm" className="max-md:size-11" asChild>
        <Link href={href} aria-label={label}>
          <Icon aria-hidden="true" />
        </Link>
      </Button>
    </Tooltip>
  );
}

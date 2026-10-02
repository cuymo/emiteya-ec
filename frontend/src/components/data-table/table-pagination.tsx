// TablePagination (data-tables.md): el mismo pie en todas las tablas, con rango, filas por página y
// controles de primera, anterior, siguiente y última página de geometría estable.
"use client";

import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";

export function TablePagination({
  total,
  page,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: {
  total: number;
  page: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const sizeId = useId();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Una página fuera de rango no muestra un intervalo imposible mientras la pantalla la corrige.
  const inRange = total > 0 && (page - 1) * pageSize < total;
  const from = inRange ? (page - 1) * pageSize + 1 : 0;
  const to = inRange ? Math.min(total, page * pageSize) : 0;
  const format = (value: number) => value.toLocaleString("es-EC");

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-1.5 py-1 text-sm text-foreground-muted">
      <p aria-live="polite">
        Mostrando {format(from)}-{format(to)} de {format(total)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={sizeId} className="flex items-center gap-1">
          Filas
          <select
            id={sizeId}
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-4 rounded-md border border-input bg-surface px-0.5 text-sm text-foreground max-md:h-5.5"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <nav aria-label="Paginación" className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="max-md:size-5.5"
            aria-label="Primera página"
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
          >
            <ChevronFirst aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="max-md:size-5.5"
            aria-label="Página anterior"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="min-w-12 text-center tabular-nums">
            Página {format(page)} de {format(pages)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="max-md:size-5.5"
            aria-label="Página siguiente"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="max-md:size-5.5"
            aria-label="Última página"
            disabled={page >= pages}
            onClick={() => onPageChange(pages)}
          >
            <ChevronLast aria-hidden="true" />
          </Button>
        </nav>
      </div>
    </div>
  );
}

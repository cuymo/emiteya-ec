// Paginación de la tabla compartida (productize-invoice-list-and-shared-table-foundation, design D5
// y D14; data-tables.md, «Pagination»). Visual portado del pie de
// `src/app/(main)/dashboard/tasks/_components/tasks.tsx` y de
// `default/_components/recent-customers-table/table.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), con los textos de EmiteYa. Las páginas salen de `meta.total` y
// `pageSize`: el servidor no envía un total de páginas. `DataTable` solo la muestra con filas, así
// que nunca enseña «0 de 0» al cargar ni con una lista vacía.
"use client";

import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export function DataTablePagination({
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
  const inRange = (page - 1) * pageSize < total;
  const from = inRange ? (page - 1) * pageSize + 1 : 0;
  const to = inRange ? Math.min(total, page * pageSize) : 0;
  const format = (value: number) => value.toLocaleString("es-EC");

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-3 py-2 text-sm text-muted-foreground">
      <p aria-live="polite" className="tabular-nums">
        Mostrando {format(from)}-{format(to)} de {format(total)}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor={sizeId} className="flex items-center gap-2">
          Filas por página
          <Select
            id={sizeId}
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-8 w-18 px-2"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </label>
        <nav aria-label="Paginación" className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Primera página"
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
          >
            <ChevronFirst aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Página anterior"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span className="min-w-24 text-center text-foreground tabular-nums">
            Página {format(page)} de {format(pages)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Página siguiente"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
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

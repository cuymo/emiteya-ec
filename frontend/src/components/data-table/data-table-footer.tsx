// Pie de una lista: filas por página, el intervalo y la paginación numerada. Portado del pie de
// `src/app/(main)/dashboard/users/_components/users-table.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), con paginación de servidor: las páginas salen de `meta.total` y
// `pageSize`, y la página la cambia el módulo en la URL.
// - Una ventana de tres páginas centrada en la actual, con puntos suspensivos si hay más.
// - Los extremos se deshabilitan de verdad en la primera y la última página.
"use client";

import { useId } from "react";
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  SelectMenu,
  SelectMenuContent,
  SelectMenuGroup,
  SelectMenuItem,
  SelectMenuTrigger,
  SelectMenuValue,
} from "@/components/ui/select-menu";
import { Separator } from "@/components/ui/separator";

/** Hasta tres páginas, en base 1, centradas en la actual. */
export function pageWindow(current: number, pages: number): number[] {
  if (pages <= 3) return Array.from({ length: pages }, (_, index) => index + 1);
  if (current <= 2) return [1, 2, 3];
  if (current >= pages - 1) return [pages - 2, pages - 1, pages];
  return [current - 1, current, current + 1];
}

export function DataTableFooter({
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
  const sizeLabelId = useId();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pages);
  // Una página fuera de rango no muestra un intervalo imposible mientras la pantalla la corrige.
  const inRange = (page - 1) * pageSize < total;
  const from = inRange ? (page - 1) * pageSize + 1 : 0;
  const to = inRange ? Math.min(total, page * pageSize) : 0;
  const format = (value: number) => value.toLocaleString("es-EC");
  const window = pageWindow(current, pages);

  return (
    <div data-slot="data-table-footer" className="flex flex-col gap-4">
      <Separator />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span id={sizeLabelId}>Filas por página</span>
            <SelectMenu
              value={String(pageSize)}
              onValueChange={(next) => onPageSizeChange(Number(next))}
            >
              <SelectMenuTrigger size="sm" aria-labelledby={sizeLabelId} className="w-20">
                <SelectMenuValue />
              </SelectMenuTrigger>
              <SelectMenuContent side="top">
                <SelectMenuGroup>
                  {pageSizeOptions.map((size) => (
                    <SelectMenuItem key={size} value={String(size)}>
                      {size}
                    </SelectMenuItem>
                  ))}
                </SelectMenuGroup>
              </SelectMenuContent>
            </SelectMenu>
          </div>
          <p aria-live="polite" className="tabular-nums">
            Mostrando {format(from)}-{format(to)} de {format(total)}
          </p>
        </div>
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                disabled={current <= 1}
                onClick={() => onPageChange(current - 1)}
              />
            </PaginationItem>
            {window[0]! > 1 && (
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
            )}
            {window.map((number) => (
              <PaginationItem key={number}>
                <PaginationButton
                  isActive={number === current}
                  aria-label={`Página ${format(number)}`}
                  onClick={() => onPageChange(number)}
                >
                  {format(number)}
                </PaginationButton>
              </PaginationItem>
            ))}
            {window[window.length - 1]! < pages && (
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
            )}
            <PaginationItem>
              <PaginationNext
                disabled={current >= pages}
                onClick={() => onPageChange(current + 1)}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}

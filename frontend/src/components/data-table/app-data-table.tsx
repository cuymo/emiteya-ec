// AppDataTable (data-tables.md): un único contrato de tabla para colecciones operativas, con
// TanStack Table, paginación de servidor, columnas opcionales, estados dentro del marco y una
// lista de tarjetas por debajo de 768px. El módulo aporta columnas, datos y acciones válidas.
"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/states";
import { cn } from "@/lib/utils";
import { DataTableFooter } from "./data-table-footer";
import { TablePagination } from "./table-pagination";

export type AppDataTableProps<T> = {
  /** Nombre accesible de la tabla. */
  label: string;
  columns: ColumnDef<T, unknown>[];
  data: T[];
  getRowId: (row: T) => string;
  total: number;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  columnVisibility: VisibilityState;
  /** Carga inicial: esqueleto con la geometría de la tabla. */
  loading: boolean;
  /** Recarga con datos previos en pantalla: la tabla se marca ocupada sin saltos. */
  refreshing?: boolean;
  /** Estado que sustituye a las filas: vacío, sin coincidencias o error, siempre dentro del marco. */
  state?: ReactNode;
  toolbar?: ReactNode;
  /** Representación de una fila como tarjeta en pantallas pequeñas. */
  renderCard: (row: T) => ReactNode;
  /**
   * Dentro de `DataTableCard`: sin marco ni barra propios, con las filas holgadas y el pie numerado
   * de la plantilla. La barra pasa a la cabecera y a la fila de filtros de la tarjeta.
   */
  bare?: boolean;
};

export function AppDataTable<T>({
  label,
  columns,
  data,
  getRowId,
  total,
  page,
  pageSize,
  pageSizeOptions = [10, 25, 50, 100],
  onPageChange,
  onPageSizeChange,
  columnVisibility,
  loading,
  refreshing = false,
  state,
  toolbar,
  renderCard,
  bare = false,
}: AppDataTableProps<T>) {
  // TanStack Table devuelve funciones no memoizables; el compilador de React lo sabe y lo omite.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: total,
    state: { columnVisibility, pagination: { pageIndex: page - 1, pageSize } },
  });
  const visibleColumns = table.getVisibleLeafColumns().length;
  const showRows = !loading && !state;

  return (
    <div className="flex flex-col gap-4">
      {!bare && toolbar}
      <div
        data-slot="data-table"
        className={cn(
          bare
            ? "flex flex-col gap-4"
            : "overflow-hidden rounded-lg border border-border bg-surface",
        )}
        aria-busy={loading || refreshing}
      >
        {/* Escritorio y tableta: tabla. */}
        <div className="relative hidden overflow-x-auto md:block">
          <table aria-label={label} className="w-full border-collapse text-sm">
            <thead
              className={cn(
                "text-left text-foreground-muted",
                bare ? "text-sm" : "bg-surface-subtle text-xs",
              )}
            >
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id} className={cn(bare && "border-t border-border")}>
                  {group.headers.map((header) => (
                    <th
                      key={header.id}
                      scope="col"
                      className={cn(
                        "whitespace-nowrap last:text-right",
                        bare ? "h-11 px-4 font-normal" : "h-10 px-3 font-medium",
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: Math.min(pageSize, 8) }, (_, index) => (
                  <tr key={`skeleton-${index}`} className="border-t border-border">
                    {Array.from({ length: visibleColumns }, (_, cell) => (
                      <td key={cell} className={cn(bare ? "h-14 px-4" : "h-12 px-3")}>
                        <Skeleton className="h-4 w-full max-w-48" />
                      </td>
                    ))}
                  </tr>
                ))}
              {state && (
                <tr className="border-t border-border">
                  <td colSpan={visibleColumns}>{state}</td>
                </tr>
              )}
              {showRows &&
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-t border-border",
                      bare ? "hover:bg-muted/40" : "hover:bg-surface-subtle/60",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn(
                          "align-middle last:w-px last:text-right",
                          bare ? "px-4 py-3" : "h-12 px-3",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {/* Móvil: lista de tarjetas priorizada, una acción a la vez. */}
        <div className="md:hidden">
          {loading && (
            <ul aria-label={label} className="flex flex-col">
              {Array.from({ length: 4 }, (_, index) => (
                <li
                  key={index}
                  className={cn(
                    "flex flex-col gap-2 border-t border-border p-4",
                    !bare && "first:border-t-0",
                  )}
                >
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-64" />
                </li>
              ))}
            </ul>
          )}
          {state}
          {showRows && (
            <ul aria-label={label} className="flex flex-col">
              {data.map((row) => (
                <li
                  key={getRowId(row)}
                  className={cn("border-t border-border p-4", !bare && "first:border-t-0")}
                >
                  {renderCard(row)}
                </li>
              ))}
            </ul>
          )}
        </div>
        {bare ? (
          showRows &&
          total > 0 && (
            <DataTableFooter
              total={total}
              page={page}
              pageSize={pageSize}
              pageSizeOptions={pageSizeOptions}
              onPageChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          )
        ) : (
          <TablePagination
            total={total}
            page={page}
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        )}
      </div>
    </div>
  );
}

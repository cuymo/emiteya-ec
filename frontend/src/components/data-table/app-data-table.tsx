// AppDataTable (data-tables.md): un único contrato de tabla para colecciones operativas, con
// TanStack Table, paginación de servidor, columnas opcionales, estados dentro del marco y una
// lista de tarjetas por debajo de 768px. El módulo aporta columnas, datos y acciones válidas.
// Va dentro de `DataTableCard`, que pone el marco, la cabecera y los filtros: la tabla llega a los
// bordes de la tarjeta, con las filas holgadas y el pie numerado de
// `users/_components/users-table.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md).
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
import { DataTableFooter } from "./data-table-footer";

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
  /** Representación de una fila como tarjeta en pantallas pequeñas. */
  renderCard: (row: T) => ReactNode;
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
  renderCard,
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
    <div data-slot="data-table" className="flex flex-col gap-4" aria-busy={loading || refreshing}>
      {/* Escritorio y tableta: tabla. */}
      <div className="relative hidden overflow-x-auto md:block">
        <table aria-label={label} className="w-full border-collapse text-sm">
          <thead className="text-left text-foreground-muted">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-t border-border">
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    className="h-11 px-4 font-normal whitespace-nowrap last:text-right"
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
                    <td key={cell} className="h-14 px-4">
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
                <tr key={row.id} className="border-t border-border hover:bg-muted/40">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle last:w-px last:text-right">
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
              <li key={index} className="flex flex-col gap-2 border-t border-border p-4">
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
              <li key={getRowId(row)} className="border-t border-border p-4">
                {renderCard(row)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {showRows && total > 0 && (
        <DataTableFooter
          total={total}
          page={page}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </div>
  );
}

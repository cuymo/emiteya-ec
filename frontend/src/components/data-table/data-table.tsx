// DataTable (productize-invoice-list-and-shared-table-foundation, design D2, D5 y D14;
// data-tables.md): la tabla compartida de las listas migradas, sobre TanStack Table 8.21.3 con
// paginación de servidor. Visual portado de `src/app/(main)/dashboard/tasks/_components/tasks.tsx` y
// `users/_components/users-table.tsx` de la plantilla «Studio Admin» (MIT;
// frontend/THIRD_PARTY_NOTICES.md), que usan TanStack v9 y tablas de cliente: aquí el cableado es
// v8 (`useReactTable`, `flexRender`, `manualPagination`) y los filtros, la página y las filas por
// página llegan del servidor y viven en la URL.
// - El módulo pone las columnas tipadas, los datos y las acciones válidas; la tabla no conoce el
//   dominio. Cada columna decide en `meta` sus clases, también las de las container queries (D15).
// - La carga, el vacío y el error ocupan la superficie de la tabla: la barra y el encabezado de la
//   página no se mueven, y el pie de paginación solo aparece con filas.
// - `onRowOpen` abre el registro al pulsar una zona no interactiva de la fila. La fila no es un
//   control: el teclado usa el enlace del registro, sin paradas duplicadas.
"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowData,
} from "@tanstack/react-table";
import type { MouseEvent, ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "./data-table-pagination";

declare module "@tanstack/react-table" {
  // TanStack exige los dos parámetros de tipo aunque la meta no los use.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Clases del encabezado (alineación, ancho, visibilidad por ancho del contenedor). */
    headClassName?: string;
    /** Clases de cada celda de la columna. */
    cellClassName?: string;
    /** Encabezado solo para lectores de pantalla, como el de la columna de acciones. */
    srOnlyHeader?: boolean;
  }
}

/** Elementos cuyo clic no abre la fila: tienen su propia acción. */
const INTERACTIVE = "a, button, input, select, textarea, label, [role=menuitem], [role=menu]";

export type DataTableProps<T> = {
  /** Nombre accesible de la tabla (`caption`). */
  label: string;
  columns: ColumnDef<T, unknown>[];
  data: T[];
  getRowId: (row: T) => string;
  /** Total de filas según el servidor (`meta.total`). */
  rowCount: number;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Primera carga: filas esqueleto con la geometría de las columnas. */
  loading: boolean;
  /** Recarga con los datos anteriores en pantalla: solo se anuncia ocupada. */
  refreshing?: boolean;
  /** Vacío, vacío por filtros o error: sustituye a las filas dentro de la superficie. */
  state?: ReactNode;
  toolbar?: ReactNode;
  /** Abre el registro desde una zona no interactiva de la fila. */
  onRowOpen?: (row: T) => void;
};

/** Un clic de fila abre el registro solo si es un clic primario sin modificadores ni selección. */
function opensRow(event: MouseEvent<HTMLTableRowElement>): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const target = event.target as Element;
  // Los menús se abren en un portal: su clic sube por React pero no está dentro de la fila.
  if (!event.currentTarget.contains(target) || target.closest(INTERACTIVE)) return false;
  return !window.getSelection()?.toString();
}

export function DataTable<T>({
  label,
  columns,
  data,
  getRowId,
  rowCount,
  page,
  pageSize,
  pageSizeOptions = [10, 25, 50, 100],
  onPageChange,
  onPageSizeChange,
  loading,
  refreshing = false,
  state,
  toolbar,
  onRowOpen,
}: DataTableProps<T>) {
  // TanStack Table devuelve funciones no memoizables; el compilador de React lo sabe y lo omite.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount,
    state: { pagination: { pageIndex: page - 1, pageSize } },
  });
  const leafColumns = table.getVisibleLeafColumns();
  const showRows = !loading && !state;
  const open = (event: MouseEvent<HTMLTableRowElement>, row: Row<T>) => {
    if (onRowOpen && opensRow(event)) onRowOpen(row.original);
  };

  return (
    <div className="flex flex-col gap-3">
      {toolbar}
      <div
        data-slot="data-table"
        className="@container overflow-hidden rounded-xl border border-border bg-card"
        aria-busy={loading || refreshing}
      >
        <Table>
          <TableCaption className="sr-only">{label}</TableCaption>
          <TableHeader className="bg-muted/40">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  return (
                    <TableHead key={header.id} className={meta?.headClassName}>
                      {header.isPlaceholder ? null : (
                        <span className={cn(meta?.srOnlyHeader && "sr-only")}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: Math.min(pageSize, 8) }, (_, index) => (
                <TableRow key={`esqueleto-${index}`} className="hover:bg-transparent">
                  {leafColumns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn("h-11", column.columnDef.meta?.cellClassName)}
                    >
                      <Skeleton className="h-4 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {state && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={leafColumns.length} className="p-0">
                  {state}
                </TableCell>
              </TableRow>
            )}
            {showRows &&
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={onRowOpen ? (event) => open(event, row) : undefined}
                  className={cn(onRowOpen && "cursor-pointer")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn("h-11", cell.column.columnDef.meta?.cellClassName)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
        {showRows && rowCount > 0 && (
          <DataTablePagination
            total={rowCount}
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

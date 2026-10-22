// Agregar productos a la factura (decisión del propietario, 2026-10-22): una tabla completa en un
// diálogo, con búsqueda, filtro por tipo y paginación, donde se eligen varios productos a la vez con
// sus casillas. La elección se conserva al cambiar de página o de filtro; «Agregar» los suma como
// líneas, en el orden en que se eligieron. Solo productos activos, los mismos que la factura acepta.
"use client";

import { PRODUCT_KIND_LABELS, type ProductKind, type ProductView } from "@facturador/contracts";
import { ChevronLeft, ChevronRight, Search, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { DataTableSelectFilter } from "@/components/data-table/data-table-select-filter";
import { Money } from "@/components/money";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useProducts } from "@/features/products/products-api";

type KindFilter = "todos" | "bienes" | "servicios";
const KIND_FILTERS: readonly { value: KindFilter; label: string }[] = [
  { value: "todos", label: "Bienes y servicios" },
  { value: "bienes", label: "Bienes" },
  { value: "servicios", label: "Servicios" },
];
const FILTER_TO_KIND: Record<KindFilter, ProductKind | undefined> = {
  todos: undefined,
  bienes: "GOOD",
  servicios: "SERVICE",
};
const PAGE_SIZE = 10;

const ivaLabel = (product: ProductView) => {
  const iva = product.taxes.find((tax) => tax.slot === "iva");
  return iva ? (iva.officialLabel ?? `Código ${iva.code}`) : "—";
};

/** Casilla nativa con su estado intermedio, para «toda la página». */
function PageCheckbox({
  checked,
  indeterminate,
  onChange,
  disabled,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <input
      type="checkbox"
      aria-label="Elegir todos los productos de esta página"
      className="size-4"
      checked={checked}
      disabled={disabled}
      ref={(element) => {
        if (element) element.indeterminate = indeterminate;
      }}
      onChange={onChange}
    />
  );
}

export function ProductPickerDialog({
  open,
  onOpenChange,
  onAdd,
  inInvoice,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Los productos elegidos, en el orden en que se eligieron. */
  onAdd: (products: ProductView[]) => void;
  /** Los productos que la factura ya lleva, para señalarlos (se pueden repetir). */
  inInvoice: ReadonlySet<string>;
  /** Foco al cerrar: con `preventDefault`, el editor lo lleva a la línea nueva. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const searchId = useId();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("todos");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlyMap<string, ProductView>>(new Map());

  // La búsqueda consulta al servidor tras una pausa, desde la primera página.
  useEffect(() => {
    if (draft.trim() === search) return;
    const timer = setTimeout(() => {
      setSearch(draft.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, search]);

  const products = useProducts(
    {
      search,
      status: "ACTIVE",
      kind: FILTER_TO_KIND[kind],
      taxStatus: undefined,
      page,
      pageSize: PAGE_SIZE,
    },
    open,
  );
  const rows = products.data?.data ?? [];
  const total = products.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const onPage = rows.filter((product) => selected.has(product.id)).length;

  function close(next: boolean) {
    if (!next) {
      setDraft("");
      setSearch("");
      setKind("todos");
      setPage(1);
      setSelected(new Map());
    }
    onOpenChange(next);
  }
  const toggle = (product: ProductView) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(product.id)) next.delete(product.id);
      else next.set(product.id, product);
      return next;
    });
  const togglePage = () =>
    setSelected((current) => {
      const next = new Map(current);
      const all = rows.every((product) => next.has(product.id));
      for (const product of rows) {
        if (all) next.delete(product.id);
        else next.set(product.id, product);
      }
      return next;
    });
  const count = selected.size;

  let body: ReactNode;
  if (products.isPending) {
    body = (
      <div aria-hidden="true" className="flex flex-col gap-2 py-2">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    );
  } else if (products.isError) {
    body = (
      <ErrorState
        message="No pudimos cargar los productos."
        onRetry={() => void products.refetch()}
      />
    );
  } else if (rows.length === 0) {
    body =
      search || kind !== "todos" ? (
        <EmptyState
          kind="no-matches"
          title="No hay productos que coincidan"
          description="Prueba con otra búsqueda o quita el filtro."
        />
      ) : (
        <EmptyState
          kind="empty"
          title="Todavía no hay productos"
          description="Registra en Productos lo que vendes, con su precio y su IVA."
        />
      );
  } else {
    body = (
      <Table aria-label="Productos activos">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <PageCheckbox
                checked={onPage === rows.length}
                indeterminate={onPage > 0 && onPage < rows.length}
                disabled={rows.length === 0}
                onChange={togglePage}
              />
            </TableHead>
            <TableHead>Producto</TableHead>
            <TableHead className="max-sm:hidden">Tipo</TableHead>
            <TableHead className="text-right">Precio sin impuestos</TableHead>
            <TableHead className="max-sm:hidden">IVA</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((product) => {
            const chosen = selected.has(product.id);
            const review = product.taxConfiguration.status !== "READY";
            return (
              <TableRow
                key={product.id}
                data-state={chosen ? "selected" : undefined}
                onClick={() => toggle(product)}
                className="cursor-pointer data-[state=selected]:bg-active"
              >
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Elegir ${product.name}`}
                    className="size-4"
                    checked={chosen}
                    onChange={() => toggle(product)}
                    // La fila también elige: el clic en la casilla no se cuenta dos veces.
                    onClick={(event) => event.stopPropagation()}
                  />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium break-words">{product.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-foreground-muted">
                      {product.mainCode && (
                        <code className="rounded-sm bg-muted px-1 py-0.5 font-mono">
                          {product.mainCode}
                        </code>
                      )}
                      {inInvoice.has(product.id) && <span>Ya en la factura</span>}
                      {review && (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <TriangleAlert aria-hidden="true" className="size-3" />
                          {product.taxConfiguration.status === "REVIEW_REQUIRED"
                            ? "Revisar impuestos"
                            : "Impuestos incompletos"}
                        </span>
                      )}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-foreground-muted max-sm:hidden">
                  {PRODUCT_KIND_LABELS[product.kind]}
                </TableCell>
                <TableCell className="text-right">
                  <Money amount={product.unitPrice} />
                </TableCell>
                <TableCell className="text-foreground-muted max-sm:hidden">
                  {ivaLabel(product)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl" {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}>
        <div className="flex flex-col gap-1 px-6 pt-6 pr-14">
          <DialogTitle className="text-lg font-semibold">Agregar productos</DialogTitle>
          <DialogDescription className="text-sm text-foreground-muted">
            Elige uno o varios productos activos; se agregan como líneas de la factura.
          </DialogDescription>
        </div>
        <div className="flex flex-col gap-3 px-6 pt-4 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-foreground-muted"
            />
            <label htmlFor={searchId} className="sr-only">
              Buscar por código o nombre
            </label>
            <Input
              id={searchId}
              type="search"
              value={draft}
              placeholder="Código o nombre"
              onChange={(event) => setDraft(event.target.value)}
              className="pl-8"
            />
          </div>
          <DataTableSelectFilter
            label="Tipo"
            value={kind}
            options={KIND_FILTERS}
            onChange={(value) => {
              setKind(value);
              setPage(1);
            }}
          />
        </div>
        <div
          className={cn(
            "min-h-64 flex-1 overflow-y-auto px-6 py-3 transition-opacity",
            products.isFetching && !products.isPending && "opacity-60",
          )}
          aria-busy={products.isFetching}
        >
          {body}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-2 text-sm text-foreground-muted">
          <p aria-live="polite">
            {total > 0
              ? `Página ${page} de ${pages} · ${total.toLocaleString("es-EC")} productos`
              : " "}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Página anterior"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Página siguiente"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
          <p aria-live="polite" className={cn("text-sm", count > 0 && "font-medium text-primary")}>
            {count === 0
              ? "Elige uno o varios productos."
              : count === 1
                ? "1 producto elegido"
                : `${count} productos elegidos`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button
              disabled={count === 0}
              onClick={() => {
                onAdd([...selected.values()]);
                close(false);
              }}
            >
              {count > 1 ? `Agregar ${count} productos` : "Agregar producto"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

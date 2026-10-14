// Inventario (add-minimal-inventory, design D13): stock contabilizado por facturas autorizadas,
// entradas y ajustes, nunca una reserva de disponibilidad. Usuario: administrador u operador, a
// diario. Objetivo: saber cuánto queda de cada producto controlado y detectar anomalías. Decisión:
// qué producto revisar, inicializar o reponer. Información mínima: código, nombre, estado y saldo.
// Acción principal: abrir el producto. P0: nombre, estado y saldo (el negativo con icono y texto);
// P1: código y último movimiento; P2: búsqueda y filtro de estado; P3 (identificadores): no se
// muestra.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type StockItemView,
  type StockListFilter,
} from "@facturador/contracts";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { ChipGroup, SearchInput } from "@/components/data-table/table-controls";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { formatDecimal } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { formatDateTime } from "@/features/invoices/invoice-format";
import { useStockItems } from "./inventory-api";
import { STOCK_STATE_BADGES } from "./inventory-format";

type StateFilter = "todos" | "sin-inicializar" | "activos" | "desactivados" | "negativos";
const STATE_FILTERS: readonly { value: StateFilter; label: string; state?: StockListFilter }[] = [
  { value: "todos", label: "Todos" },
  { value: "sin-inicializar", label: "Sin inicializar", state: "TRACKED_NOT_INITIALIZED" },
  { value: "activos", label: "Activos", state: "TRACKED_INITIALIZED" },
  { value: "desactivados", label: "Control desactivado", state: "DISABLED_INITIALIZED" },
  { value: "negativos", label: "Saldo negativo", state: "NEGATIVE" },
];
const isStateFilter = (value: string | null): value is StateFilter =>
  STATE_FILTERS.some((filter) => filter.value === value);

export const stockItemPath = (productId: string) => `/inventario/${encodeURIComponent(productId)}`;

function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const stateParam = params.get("estado");
  const filter: StateFilter = isStateFilter(stateParam) ? stateParam : "todos";
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get("filas") ?? "", 10);
  const pageSize = sizeParam >= 1 && sizeParam <= PAGE_SIZE_MAX ? sizeParam : PAGE_SIZE_DEFAULT;
  function update(changes: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    for (const [key, change] of Object.entries(changes)) {
      if (change === null || change === "") next.delete(key);
      else next.set(key, change);
    }
    if (resetPage) next.delete("pagina");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  return { filter, page, pageSize, search: params.get("q") ?? "", update };
}

/** Saldo: sin cifra antes de inicializar; el negativo, con icono y texto, nunca solo color. */
export function BalanceCell({
  item,
  wrap = true,
}: {
  item: Pick<StockItemView, "balance" | "negative">;
  /** En la tabla, el saldo negativo queda en una línea; en las tarjetas, puede partirse. */
  wrap?: boolean;
}) {
  if (item.balance === null) {
    return <span className="text-sm whitespace-nowrap text-foreground-muted">Sin saldo</span>;
  }
  if (item.negative) {
    return (
      <span
        className={`inline-flex ${wrap ? "flex-wrap" : "whitespace-nowrap"} items-center justify-end gap-1 text-danger`}
      >
        <TriangleAlert aria-hidden="true" className="size-4" />
        <span className="text-sm font-medium whitespace-nowrap text-foreground">
          Saldo negativo
        </span>
        <span className="font-medium tabular-nums">{formatDecimal(item.balance)}</span>
      </span>
    );
  }
  return <span className="tabular-nums">{formatDecimal(item.balance)}</span>;
}

export function StockStateBadge({ state }: { state: StockItemView["state"] }) {
  const badge = STOCK_STATE_BADGES[state];
  return <StatusBadge tone={badge.tone} label={badge.label} icon={badge.icon} />;
}

function ProductLink({ item }: { item: StockItemView }) {
  return (
    <Link
      href={stockItemPath(item.productId)}
      className="flex flex-col underline-offset-2 hover:underline"
    >
      <span className="font-medium break-words">{item.name}</span>
      {item.mainCode && (
        <span className="text-xs text-foreground-muted tabular-nums">{item.mainCode}</span>
      )}
    </Link>
  );
}

export function InventoryScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "inventory.read");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const items = useStockItems(
    {
      search: url.search,
      state: STATE_FILTERS.find((filter) => filter.value === url.filter)?.state,
      page: url.page,
      pageSize: url.pageSize,
    },
    allowed,
  );
  const forbidden = items.error instanceof ApiError && items.error.status === 403;
  const filtersActive = url.search !== "" || url.filter !== "todos";

  const columns = useMemo<ColumnDef<StockItemView, unknown>[]>(
    () => [
      {
        id: "product",
        header: "Producto",
        cell: ({ row }) => <ProductLink item={row.original} />,
      },
      {
        id: "state",
        header: "Estado",
        cell: ({ row }) => <StockStateBadge state={row.original.state} />,
      },
      {
        id: "balance",
        header: () => <span className="block text-right">Saldo</span>,
        cell: ({ row }) => (
          <span className="block text-right">
            <BalanceCell item={row.original} wrap={false} />
          </span>
        ),
      },
      {
        id: "lastMovement",
        header: "Último movimiento",
        cell: ({ row }) =>
          row.original.lastMovementAt ? (
            <span className="whitespace-nowrap tabular-nums">
              {formatDateTime(row.original.lastMovementAt)}
            </span>
          ) : (
            <span className="text-foreground-muted">—</span>
          ),
      },
    ],
    [],
  );

  if (!allowed || forbidden) {
    return (
      <section aria-labelledby="inventario-titulo" className="flex flex-col gap-6">
        <h1 id="inventario-titulo" className="text-3xl font-bold">
          Inventario
        </h1>
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a Inventario"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }

  const clearFilters = () => {
    setSearchDraft("");
    url.update({ q: null, estado: null });
  };

  const tableState = items.isError ? (
    <ErrorState message="No pudimos cargar el inventario." onRetry={() => void items.refetch()} />
  ) : items.data && items.data.data.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay productos que coincidan"
        description="Prueba con otro código o nombre, o quita los filtros."
        action={
          <Button variant="outline" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        }
      />
    ) : (
      <EmptyState
        kind="empty"
        title="Todavía no hay productos con control de stock"
        description="Marca un bien como controlado en Productos para llevar su inventario aquí."
        {...(canSee(me.role, "products.read")
          ? {
              action: (
                <Button variant="outline" asChild>
                  <Link href="/productos">Ir a Productos</Link>
                </Button>
              ),
            }
          : {})}
      />
    )
  ) : undefined;

  return (
    <section aria-labelledby="inventario-titulo" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="inventario-titulo" className="text-3xl font-bold">
          Inventario
        </h1>
        <p className="text-sm text-foreground-muted">
          Stock contabilizado con las facturas autorizadas, las entradas y los ajustes. No reserva
          existencias.
        </p>
      </div>
      <AppDataTable
        label="Productos con control de stock"
        columns={columns}
        data={items.data?.data ?? []}
        getRowId={(item) => item.productId}
        total={items.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={items.isPending}
        refreshing={items.isFetching}
        state={tableState}
        toolbar={
          <div className="flex flex-wrap items-center gap-4">
            <SearchInput
              value={searchDraft}
              onChange={setSearchDraft}
              label="Buscar por código o nombre"
              placeholder="Código o nombre"
            />
            <ChipGroup
              label="Estado"
              value={url.filter}
              options={STATE_FILTERS}
              onChange={(value) => url.update({ estado: value === "todos" ? null : value })}
            />
          </div>
        }
        renderCard={(item) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <ProductLink item={item} />
              <BalanceCell item={item} />
            </div>
            <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <StockStateBadge state={item.state} />
              {item.lastMovementAt && (
                <span className="tabular-nums text-foreground-muted">
                  {formatDateTime(item.lastMovementAt)}
                </span>
              )}
            </span>
          </div>
        )}
      />
    </section>
  );
}

export function InventorySkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-60 w-full" />
    </section>
  );
}

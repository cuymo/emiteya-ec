// Productos (add-parties-and-products, design D17). Usuario: administrador u operador. Objetivo:
// tener los ítems que se venden con su precio sin impuestos y sus impuestos correctos. Decisión:
// ¿este producto está listo para facturar, o qué hay que corregir? Información mínima: código,
// nombre, tipo, precio, IVA y estado tributario. Acción principal: Nuevo producto. P1: filtros con
// recuentos y formulario; P2: motivos del estado tributario, en el diálogo; P3 (historial): fuera.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PRODUCT_KIND_LABELS,
  type ProductKind,
  type ProductView,
  type RecordStatus,
  type TaxConfigurationStatus,
} from "@facturador/contracts";
import { CircleDashed, PackageCheck, PackageX, Pencil, Plus, TriangleAlert } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DataTableCard } from "@/components/data-table/data-table-card";
import { DataTableSelectFilter } from "@/components/data-table/data-table-select-filter";
import { RowActionButton, SearchInput } from "@/components/data-table/table-controls";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { formatDecimal } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ProductDialog } from "./product-dialog";
import { useChangeProductStatus, useProducts, useProductTaxSummary } from "./products-api";

type StatusFilter = "activos" | "desactivados" | "todos";
const STATUS_FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "activos", label: "Activos" },
  { value: "desactivados", label: "Desactivados" },
  { value: "todos", label: "Todos" },
];
const FILTER_TO_STATUS: Record<StatusFilter, RecordStatus | "ALL"> = {
  activos: "ACTIVE",
  desactivados: "INACTIVE",
  todos: "ALL",
};
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
type TaxFilter = "todos" | "listos" | "revisar" | "incompletos";
const FILTER_TO_TAX: Record<TaxFilter, TaxConfigurationStatus | undefined> = {
  todos: undefined,
  listos: "READY",
  revisar: "REVIEW_REQUIRED",
  incompletos: "INCOMPLETE",
};

export const TAX_STATUS_BADGES: Record<
  TaxConfigurationStatus,
  { tone: "success" | "warning" | "info"; label: string; icon: typeof PackageCheck }
> = {
  READY: { tone: "success", label: "Listo", icon: PackageCheck },
  REVIEW_REQUIRED: { tone: "warning", label: "Revisar impuestos", icon: TriangleAlert },
  INCOMPLETE: { tone: "info", label: "Incompleto", icon: CircleDashed },
};

const CARD = {
  title: "Productos",
  titleId: "productos-titulo",
  description: "Lo que vendes, con su precio sin impuestos, su IVA y su estado tributario.",
};
function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const statusParam = params.get("estado");
  const filter: StatusFilter =
    statusParam === "desactivados" || statusParam === "todos" ? statusParam : "activos";
  const kindParam = params.get("tipo");
  const kind: KindFilter =
    kindParam === "bienes" || kindParam === "servicios" ? kindParam : "todos";
  const taxParam = params.get("tributario");
  const tax: TaxFilter =
    taxParam === "listos" || taxParam === "revisar" || taxParam === "incompletos"
      ? taxParam
      : "todos";
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get("filas") ?? "", 10);
  const pageSize = sizeParam >= 1 && sizeParam <= PAGE_SIZE_MAX ? sizeParam : PAGE_SIZE_DEFAULT;
  const search = params.get("q") ?? "";

  function update(changes: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete("pagina");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return { filter, kind, tax, page, pageSize, search, update };
}

function TaxCell({ product }: { product: ProductView }) {
  const badge = TAX_STATUS_BADGES[product.taxConfiguration.status];
  return <StatusBadge tone={badge.tone} label={badge.label} icon={badge.icon} />;
}

function StatusCell({ product }: { product: ProductView }) {
  return product.status === "ACTIVE" ? (
    <StatusBadge tone="success" label="Activo" />
  ) : (
    <StatusBadge tone="neutral" label="Desactivado" />
  );
}

const ivaLabel = (product: ProductView) => {
  const iva = product.taxes.find((tax) => tax.slot === "iva");
  return iva ? (iva.officialLabel ?? `Código ${iva.code}`) : "—";
};

function RowActions({
  product,
  canChangeStatus,
  busy,
  onEdit,
  onToggleStatus,
}: {
  product: ProductView;
  canChangeStatus: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
}) {
  const active = product.status === "ACTIVE";
  return (
    <div className="inline-flex items-center gap-1">
      <RowActionButton
        icon={Pencil}
        label={`Corregir ${product.name}`}
        onClick={onEdit}
        disabled={busy}
      />
      {canChangeStatus && (
        <RowActionButton
          icon={active ? PackageX : PackageCheck}
          label={active ? `Desactivar ${product.name}` : `Reactivar ${product.name}`}
          onClick={onToggleStatus}
          disabled={busy}
        />
      )}
    </div>
  );
}

export function ProductsScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "products.read");
  const canManage = canSee(me.role, "products.manage");
  const canChangeStatus = canSee(me.role, "products.changeStatus");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});
  const [editing, setEditing] = useState<ProductView | null>(null);
  const [creating, setCreating] = useState(false);
  const status = useChangeProductStatus();
  const summary = useProductTaxSummary(allowed);
  // En móvil, estado y tipo van tras "Más filtros" (data-tables.md); desde 768 px, a la vista.
  const [moreFilters, setMoreFilters] = useState(false);
  const moreFiltersId = useId();

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const products = useProducts(
    {
      search: url.search,
      status: FILTER_TO_STATUS[url.filter],
      kind: FILTER_TO_KIND[url.kind],
      taxStatus: FILTER_TO_TAX[url.tax],
      page: url.page,
      pageSize: url.pageSize,
    },
    allowed,
  );
  const total = products.data?.meta.total;
  const lastPage = total ? Math.ceil(total / url.pageSize) : 1;
  useEffect(() => {
    if (total !== undefined && total > 0 && url.page > lastPage)
      url.update({ pagina: String(lastPage) }, false);
  }, [total, lastPage, url]);
  const forbidden = products.error instanceof ApiError && products.error.status === 403;
  const filtersActive =
    url.search !== "" || url.filter !== "activos" || url.kind !== "todos" || url.tax !== "todos";
  const secondaryActive = (url.filter !== "activos" ? 1 : 0) + (url.kind !== "todos" ? 1 : 0);

  const counts = summary.data?.byStatus;
  const withCount = (label: string, count: number | undefined) =>
    count === undefined ? label : `${label} (${count})`;
  const taxFilters: readonly { value: TaxFilter; label: string }[] = [
    { value: "todos", label: "Todo estado tributario" },
    { value: "listos", label: withCount("Listos", counts?.READY) },
    { value: "revisar", label: withCount("Revisar impuestos", counts?.REVIEW_REQUIRED) },
    { value: "incompletos", label: withCount("Incompletos", counts?.INCOMPLETE) },
  ];

  const toggle = (product: ProductView) =>
    status.mutate({ product, status: product.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" });
  const actions = (product: ProductView) => (
    <RowActions
      product={product}
      canChangeStatus={canChangeStatus}
      busy={status.isPending && status.variables?.product.id === product.id}
      onEdit={() => setEditing(product)}
      onToggleStatus={() => toggle(product)}
    />
  );

  const columns = useMemo<ColumnDef<ProductView, unknown>[]>(
    () => [
      {
        id: "code",
        header: "Código",
        cell: ({ row }) => <span className="tabular-nums">{row.original.mainCode ?? "—"}</span>,
      },
      {
        id: "name",
        header: "Nombre",
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium break-words">{row.original.name}</span>
            {row.original.auxiliaryCode && (
              <span className="text-xs text-foreground-muted">
                Auxiliar {row.original.auxiliaryCode}
              </span>
            )}
          </span>
        ),
      },
      { id: "kind", header: "Tipo", cell: ({ row }) => PRODUCT_KIND_LABELS[row.original.kind] },
      {
        id: "unitPrice",
        header: () => <span className="block text-right">Precio sin impuestos</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">
            {formatDecimal(row.original.unitPrice, { minFractionDigits: 2 })}
          </span>
        ),
      },
      { id: "iva", header: "IVA", cell: ({ row }) => ivaLabel(row.original) },
      {
        id: "tax",
        header: "Estado tributario",
        cell: ({ row }) => <TaxCell product={row.original} />,
      },
      { id: "status", header: "Estado", cell: ({ row }) => <StatusCell product={row.original} /> },
      {
        id: "actions",
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => (canManage ? actions(row.original) : null),
      },
    ],
    // Las acciones dependen del permiso y de la mutación en curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canManage, canChangeStatus, status.isPending, status.variables],
  );

  if (!allowed || forbidden) {
    return (
      <DataTableCard {...CARD}>
        <div className="px-4 pb-4">
          <EmptyState
            kind="no-permission"
            title="No tienes acceso a Productos"
            description="Pide a un administrador que revise tu rol."
          />
        </div>
      </DataTableCard>
    );
  }

  const tableState = products.isError ? (
    <ErrorState
      message="No pudimos cargar los productos."
      onRetry={() => void products.refetch()}
    />
  ) : products.data && products.data.data.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay productos que coincidan"
        description="Prueba con otra búsqueda o quita los filtros."
        action={
          <Button
            variant="outline"
            onClick={() => {
              setSearchDraft("");
              url.update({ q: null, estado: null, tipo: null, tributario: null });
            }}
          >
            Limpiar filtros
          </Button>
        }
      />
    ) : (
      <EmptyState
        kind="empty"
        title="Todavía no hay productos"
        description="Registra lo que vendes, con su precio sin impuestos y su IVA."
      />
    )
  ) : undefined;

  return (
    <>
      <DataTableCard
        {...CARD}
        search={
          <SearchInput
            value={searchDraft}
            onChange={setSearchDraft}
            label="Buscar por código o nombre"
            placeholder="Código o nombre"
          />
        }
        actions={
          canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              Nuevo producto
            </Button>
          )
        }
        filters={
          <>
            <DataTableSelectFilter
              label="Estado tributario"
              value={url.tax}
              options={taxFilters}
              onChange={(value) => url.update({ tributario: value === "todos" ? null : value })}
            />
            <Button
              variant="outline"
              size="sm"
              className="max-md:w-full md:hidden"
              aria-expanded={moreFilters}
              aria-controls={moreFiltersId}
              onClick={() => setMoreFilters((open) => !open)}
            >
              {secondaryActive > 0 ? `Más filtros (${secondaryActive})` : "Más filtros"}
            </Button>
            <div
              id={moreFiltersId}
              className={cn(
                moreFilters ? "flex" : "hidden",
                "flex-wrap items-center gap-3 max-md:w-full max-md:flex-col md:flex",
              )}
            >
              <DataTableSelectFilter
                label="Estado"
                value={url.filter}
                options={STATUS_FILTERS}
                onChange={(value) => url.update({ estado: value === "activos" ? null : value })}
              />
              <DataTableSelectFilter
                label="Tipo"
                value={url.kind}
                options={KIND_FILTERS}
                onChange={(value) => url.update({ tipo: value === "todos" ? null : value })}
              />
            </div>
          </>
        }
      >
        <AppDataTable
          label="Productos y servicios de la empresa"
          columns={columns}
          data={products.data?.data ?? []}
          getRowId={(product) => product.id}
          total={products.data?.meta.total ?? 0}
          page={url.page}
          pageSize={url.pageSize}
          onPageChange={(page) => url.update({ pagina: String(page) }, false)}
          onPageSizeChange={(size) => url.update({ filas: String(size) })}
          columnVisibility={visibility}
          loading={products.isPending}
          refreshing={products.isFetching}
          state={tableState}
          renderCard={(product) => (
            <div className="flex flex-col gap-2">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium break-words">{product.name}</span>
                <span className="text-sm text-foreground-muted tabular-nums">
                  {product.mainCode ? `${product.mainCode} · ` : ""}
                  {PRODUCT_KIND_LABELS[product.kind]} ·{" "}
                  {formatDecimal(product.unitPrice, { minFractionDigits: 2 })} · IVA{" "}
                  {ivaLabel(product)}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <TaxCell product={product} />
                  <StatusCell product={product} />
                </span>
              </div>
              {canManage && <div className="-ml-2">{actions(product)}</div>}
            </div>
          )}
        />
      </DataTableCard>

      <ProductDialog
        open={creating || editing !== null}
        product={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </>
  );
}

/** Geometría de la pantalla mientras se leen los parámetros de la URL. */
export function ProductsSkeleton() {
  return (
    <DataTableCard {...CARD} busy>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    </DataTableCard>
  );
}

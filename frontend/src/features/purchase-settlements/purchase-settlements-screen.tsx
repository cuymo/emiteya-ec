// Liquidaciones de compra (add-purchase-settlements, design D24). Usuario: administrador u operador.
// Objetivo: encontrar una liquidación y su estado. Decisión: cuál abrir. Información mínima: número,
// proveedor, fecha, importe total y estado. Acción principal: abrir la liquidación; secundaria:
// "Nueva liquidación de compra". P0: número y estado; P1: proveedor, fecha e importe total; P2:
// búsqueda y filtro de estado en la URL, y los borradores en curso; P3 (identificadores): no se
// muestran.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type InvoiceState,
  type PurchaseSettlementDraftSummaryView,
  type PurchaseSettlementSummaryView,
} from "@facturador/contracts";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { ChipGroup, RowActionButton, SearchInput } from "@/components/data-table/table-controls";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { formatDateTime, formatIssueDate } from "@/features/invoices/invoice-format";
import { StateCell } from "@/features/invoices/invoices-screen";
import {
  useDeletePurchaseSettlementDraft,
  usePurchaseSettlementDrafts,
  usePurchaseSettlements,
} from "./purchase-settlements-api";

type StateFilter =
  | "todas"
  | "autorizadas"
  | "pendientes-autorizacion"
  | "pendientes-envio"
  | "verificando"
  | "revision"
  | "devueltas"
  | "no-autorizadas"
  | "procesando";
const STATE_FILTERS: readonly { value: StateFilter; label: string; state?: InvoiceState }[] = [
  { value: "todas", label: "Todas" },
  { value: "autorizadas", label: "Autorizadas", state: "AUTHORIZED" },
  { value: "pendientes-autorizacion", label: "Pendientes de autorización", state: "RECEIVED" },
  { value: "pendientes-envio", label: "Pendientes de envío", state: "SIGNED" },
  { value: "verificando", label: "Verificando con el SRI", state: "SEND_UNKNOWN" },
  { value: "revision", label: "Requieren revisión", state: "MANUAL_REVIEW" },
  { value: "devueltas", label: "Devueltas", state: "RETURNED" },
  { value: "no-autorizadas", label: "No autorizadas", state: "NOT_AUTHORIZED" },
  { value: "procesando", label: "Procesando", state: "RESERVED" },
];
const isStateFilter = (value: string | null): value is StateFilter =>
  STATE_FILTERS.some((filter) => filter.value === value);

function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const stateParam = params.get("estado");
  const filter: StateFilter = isStateFilter(stateParam) ? stateParam : "todas";
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get("filas") ?? "", 10);
  const pageSize = sizeParam >= 1 && sizeParam <= PAGE_SIZE_MAX ? sizeParam : PAGE_SIZE_DEFAULT;
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
  return { filter, page, pageSize, search: params.get("q") ?? "", update };
}

const lineCountLabel = (count: number) => (count === 1 ? "1 línea" : `${count} líneas`);

/** Borradores en curso: se abren para seguir editándolos o se eliminan. */
function DraftsPanel() {
  const headingId = useId();
  const drafts = usePurchaseSettlementDrafts({ page: 1, pageSize: 10 }, true);
  const [deleting, setDeleting] = useState<PurchaseSettlementDraftSummaryView | null>(null);
  const remove = useDeletePurchaseSettlementDraft({ onSuccess: () => setDeleting(null) });
  if (drafts.isPending || drafts.isError || drafts.data.data.length === 0) return null;
  const { data, meta } = drafts.data;
  const nameOf = (draft: PurchaseSettlementDraftSummaryView) =>
    draft.supplierName ? `Liquidación a ${draft.supplierName}` : "Liquidación sin proveedor";
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-lg font-semibold">
        Borradores en curso
      </h2>
      <ul className="flex flex-col gap-1">
        {data.map((draft) => (
          <li
            key={draft.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            <span className="flex min-w-0 flex-col">
              <Link
                href={`/liquidaciones-compra/borradores/${draft.id}`}
                className="font-medium break-words underline-offset-2 hover:underline"
              >
                {nameOf(draft)}
              </Link>
              <span className="text-foreground-muted break-words">
                {lineCountLabel(draft.lineCount)} ·{" "}
                {draft.previewTotal ? formatUsd(draft.previewTotal) : "Sin importe calculado"} ·{" "}
                {formatDateTime(draft.updatedAt)}
              </span>
            </span>
            <RowActionButton
              icon={Trash2}
              label={`Eliminar el borrador: ${nameOf(draft)}`}
              onClick={() => setDeleting(draft)}
            />
          </li>
        ))}
      </ul>
      {meta.total > data.length && (
        <p className="text-sm text-foreground-muted">
          Se muestran los {data.length} borradores más recientes de {meta.total}.
        </p>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Eliminar borrador"
        description={
          <p>
            Se elimina el borrador {deleting ? `"${nameOf(deleting)}"` : ""}. No reserva nada: no
            consume números.
          </p>
        }
        confirmLabel="Eliminar"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </section>
  );
}

export function PurchaseSettlementsScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "purchaseSettlements.read");
  const canDraft = canSee(me.role, "purchaseSettlements.draft");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const settlements = usePurchaseSettlements(
    {
      search: url.search,
      state: STATE_FILTERS.find((filter) => filter.value === url.filter)?.state,
      page: url.page,
      pageSize: url.pageSize,
    },
    allowed,
  );
  const forbidden = settlements.error instanceof ApiError && settlements.error.status === 403;
  const filtersActive = url.search !== "" || url.filter !== "todas";

  const columns = useMemo<ColumnDef<PurchaseSettlementSummaryView, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Número",
        cell: ({ row }) => (
          <Link
            href={`/liquidaciones-compra/${row.original.id}`}
            className="font-medium whitespace-nowrap tabular-nums underline-offset-2 hover:underline"
          >
            {row.original.documentNumber}
          </Link>
        ),
      },
      {
        id: "supplier",
        header: "Proveedor",
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="break-words">{row.original.supplierName}</span>
            <span className="text-xs text-foreground-muted tabular-nums">
              {row.original.supplierIdentification}
            </span>
          </span>
        ),
      },
      {
        id: "date",
        header: "Fecha",
        cell: ({ row }) => (
          <span className="tabular-nums">{formatIssueDate(row.original.issueDate)}</span>
        ),
      },
      {
        id: "total",
        header: () => <span className="block text-right">Importe total</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{formatUsd(row.original.total)}</span>
        ),
      },
      {
        id: "state",
        header: "Estado",
        cell: ({ row }) => (
          <StateCell state={row.original.state} stopped={row.original.transmissionStopped} />
        ),
      },
    ],
    [],
  );

  const title = (
    <h1 id="liquidaciones-titulo" className="text-3xl font-bold">
      Liquidaciones de compra
    </h1>
  );
  if (!allowed || forbidden) {
    return (
      <section aria-labelledby="liquidaciones-titulo" className="flex flex-col gap-6">
        {title}
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a Liquidaciones de compra"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }

  const newSettlement = canDraft ? (
    <Button asChild>
      <Link href="/liquidaciones-compra/borradores/nueva">
        <Plus aria-hidden="true" />
        Nueva liquidación de compra
      </Link>
    </Button>
  ) : null;
  const tableState = settlements.isError ? (
    <ErrorState
      message="No pudimos cargar las liquidaciones de compra."
      onRetry={() => void settlements.refetch()}
    />
  ) : settlements.data && settlements.data.data.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay liquidaciones que coincidan"
        description="Prueba con otro número, identificación o nombre del proveedor, o quita los filtros."
        action={
          <Button
            variant="outline"
            onClick={() => {
              setSearchDraft("");
              url.update({ q: null, estado: null });
            }}
          >
            Limpiar filtros
          </Button>
        }
      />
    ) : (
      <EmptyState
        kind="empty"
        title="Todavía no hay liquidaciones de compra"
        description="La empresa emite una liquidación de compra cuando adquiere bienes muebles o servicios a una persona natural no obligada a llevar contabilidad que, sin RUC o con su RUC suspendido, no puede emitir comprobantes de venta por su nivel cultural o rusticidad (art. 13, letra c, del Reglamento de Comprobantes de Venta)."
        action={newSettlement ?? undefined}
      />
    )
  ) : undefined;

  return (
    <section aria-labelledby="liquidaciones-titulo" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {title}
        {newSettlement}
      </div>
      {canDraft && <DraftsPanel />}
      <AppDataTable
        label="Liquidaciones de compra emitidas"
        columns={columns}
        data={settlements.data?.data ?? []}
        getRowId={(settlement) => settlement.id}
        total={settlements.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={settlements.isPending}
        refreshing={settlements.isFetching}
        state={tableState}
        toolbar={
          <div className="flex flex-col gap-3">
            <SearchInput
              value={searchDraft}
              onChange={setSearchDraft}
              label="Buscar por número o proveedor"
              placeholder="Número o proveedor"
            />
            <ChipGroup
              label="Estado"
              value={url.filter}
              options={STATE_FILTERS}
              onChange={(value) => url.update({ estado: value === "todas" ? null : value })}
            />
          </div>
        }
        renderCard={(settlement) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/liquidaciones-compra/${settlement.id}`}
                className="font-medium whitespace-nowrap tabular-nums underline-offset-2 hover:underline"
              >
                {settlement.documentNumber}
              </Link>
              <span className="text-sm text-foreground-muted tabular-nums">
                {formatIssueDate(settlement.issueDate)}
              </span>
            </div>
            <span className="text-sm break-words">{settlement.supplierName}</span>
            <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-foreground-muted tabular-nums">
                {settlement.supplierIdentification}
              </span>
              <span className="tabular-nums">{formatUsd(settlement.total)}</span>
            </span>
            <StateCell state={settlement.state} stopped={settlement.transmissionStopped} />
          </div>
        )}
      />
    </section>
  );
}

export function PurchaseSettlementsSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Liquidaciones de compra</h1>
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-64 w-full" />
    </section>
  );
}

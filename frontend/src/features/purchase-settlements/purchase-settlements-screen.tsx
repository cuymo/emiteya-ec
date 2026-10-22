// Liquidaciones de compra (add-purchase-settlements, design D24). Usuario: administrador u operador.
// Objetivo: encontrar una liquidación y su estado. Decisión: cuál abrir. Información mínima: número,
// proveedor, fecha, importe total y estado. Acción principal: abrir la liquidación; secundaria:
// "Nueva liquidación de compra". P0: número y estado; P1: proveedor, fecha e importe total; P2:
// búsqueda y filtro de estado en la URL; P3 (identificadores): no se muestran. Los borradores van
// en la misma tabla, primero, con su estado «Borrador» filtrable (unify-drafts-into-document-lists,
// design D5).
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type EntryState,
  type PurchaseSettlementDraftSummaryView,
  type PurchaseSettlementEntryView,
} from "@facturador/contracts";
import { Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DataTableCard } from "@/components/data-table/data-table-card";
import { DataTableSelectFilter } from "@/components/data-table/data-table-select-filter";
import { RowActionsMenu } from "@/components/data-table/row-actions-menu";
import { SearchInput } from "@/components/data-table/table-controls";
import { AsyncButton } from "@/components/async-button";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  MoneyCell,
  MutedCell,
  PartyCell,
  RecordLink,
} from "@/components/data-table/data-table-cells";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import { DraftStateBadge, StateCell } from "@/features/documents/document-status-badge";
import {
  DRAFT_FILTER_LABEL,
  DRAFT_STATE_PARAM,
  DraftEditedAt,
  DraftParty,
  draftRowActions,
} from "@/features/documents/draft-entries";
import {
  useDeletePurchaseSettlementDraft,
  usePurchaseSettlementEntries,
} from "./purchase-settlements-api";
import { useNewPurchaseSettlement } from "./new-purchase-settlement";

type StateFilter =
  | "todas"
  | typeof DRAFT_STATE_PARAM
  | "autorizadas"
  | "pendientes-autorizacion"
  | "pendientes-envio"
  | "verificando"
  | "revision"
  | "devueltas"
  | "no-autorizadas"
  | "procesando";
const STATE_FILTERS: readonly { value: StateFilter; label: string; state?: EntryState }[] = [
  { value: "todas", label: "Todas" },
  { value: DRAFT_STATE_PARAM, label: DRAFT_FILTER_LABEL, state: "DRAFT" },
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

const CARD = {
  title: "Liquidaciones de compra",
  titleId: "liquidaciones-titulo",
  description: "Las liquidaciones de compra que emites a proveedores que no entregan factura.",
};
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

const draftHref = (draft: PurchaseSettlementDraftSummaryView) =>
  `/liquidaciones-compra/borradores/${draft.id}`;
const entryId = (entry: PurchaseSettlementEntryView) =>
  entry.kind === "DRAFT" ? `borrador-${entry.draft.id}` : entry.document.id;
/** El nombre del borrador en su menú y en la confirmación de su eliminación. */
const draftName = (draft: PurchaseSettlementDraftSummaryView) =>
  draft.supplierName ? `Liquidación a ${draft.supplierName}` : "Liquidación sin proveedor";

export function PurchaseSettlementsScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "purchaseSettlements.read");
  const canDraft = canSee(me.role, "purchaseSettlements.draft");
  // «Nueva liquidación de compra» se abre sobre la lista, sin una página intermedia (decisión del propietario,
  // 2026-10-22).
  const creation = useNewPurchaseSettlement(canDraft);
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});
  const [deleting, setDeleting] = useState<PurchaseSettlementDraftSummaryView | null>(null);
  const remove = useDeletePurchaseSettlementDraft({ onSuccess: () => setDeleting(null) });

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const settlements = usePurchaseSettlementEntries(
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

  const columns = useMemo<ColumnDef<PurchaseSettlementEntryView, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Número",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <RecordLink href={draftHref(row.original.draft)}>Borrador</RecordLink>
          ) : (
            <RecordLink href={`/liquidaciones-compra/${row.original.document.id}`}>
              {row.original.document.documentNumber}
            </RecordLink>
          ),
      },
      {
        id: "supplier",
        header: "Proveedor",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <DraftParty name={row.original.draft.supplierName} missing="Sin proveedor" />
          ) : (
            <PartyCell
              name={row.original.document.supplierName}
              identification={row.original.document.supplierIdentification}
            />
          ),
      },
      {
        id: "date",
        header: "Fecha",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <DraftEditedAt updatedAt={row.original.draft.updatedAt} />
          ) : (
            <MutedCell>{formatIssueDate(row.original.document.issueDate)}</MutedCell>
          ),
      },
      {
        id: "total",
        header: () => <span className="block text-right">Importe total</span>,
        cell: ({ row }) => {
          const amount =
            row.original.kind === "DRAFT"
              ? row.original.draft.previewTotal
              : row.original.document.total;
          return amount === null ? (
            <MutedCell className="block text-right">Incompleto</MutedCell>
          ) : (
            <MoneyCell amount={amount} className="block text-right" />
          );
        },
      },
      {
        id: "state",
        header: "Estado",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <DraftStateBadge />
          ) : (
            <StateCell
              state={row.original.document.state}
              stopped={row.original.document.transmissionStopped}
            />
          ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <DraftActions
              draft={row.original.draft}
              onDelete={canDraft ? setDeleting : undefined}
            />
          ) : null,
      },
    ],
    [canDraft],
  );

  if (!allowed || forbidden) {
    return (
      <DataTableCard {...CARD}>
        <div className="px-4 pb-4">
          <EmptyState
            kind="no-permission"
            title="No tienes acceso a Liquidaciones de compra"
            description="Pide a un administrador que revise tu rol."
          />
        </div>
      </DataTableCard>
    );
  }

  // La acción va en el encabezado como principal; el estado vacío la repite en `outline`, sin una
  // segunda principal (productize-invoice-editor-and-composition-foundation, design D11).
  const newSettlement = (variant: "primary" | "outline", size: "default" | "sm" = "default") =>
    canDraft ? (
      <AsyncButton
        variant={variant}
        size={size}
        pending={creation.pending}
        onClick={creation.start}
      >
        <Plus aria-hidden="true" />
        Nueva liquidación de compra
      </AsyncButton>
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
        action={newSettlement("outline") ?? undefined}
      />
    )
  ) : undefined;

  return (
    <DataTableCard
      {...CARD}
      search={
        <SearchInput
          value={searchDraft}
          onChange={setSearchDraft}
          label="Buscar por número o proveedor"
          placeholder="Número o proveedor"
        />
      }
      actions={newSettlement("primary", "sm")}
      filters={
        <>
          <DataTableSelectFilter
            label="Estado"
            value={url.filter}
            options={STATE_FILTERS}
            onChange={(value) => url.update({ estado: value === "todas" ? null : value })}
          />
        </>
      }
    >
      <AppDataTable
        label="Liquidaciones de compra y borradores"
        columns={columns}
        data={settlements.data?.data ?? []}
        getRowId={entryId}
        total={settlements.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={settlements.isPending}
        refreshing={settlements.isFetching}
        state={tableState}
        renderCard={(entry) =>
          entry.kind === "DRAFT" ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <RecordLink href={draftHref(entry.draft)}>Borrador</RecordLink>
                {entry.draft.previewTotal === null ? (
                  <MutedCell>Incompleto</MutedCell>
                ) : (
                  <MoneyCell amount={entry.draft.previewTotal} />
                )}
              </div>
              <span className="text-sm break-words">
                <DraftParty name={entry.draft.supplierName} missing="Sin proveedor" />
              </span>
              <span className="text-sm">
                <DraftEditedAt updatedAt={entry.draft.updatedAt} />
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <DraftStateBadge />
                <DraftActions draft={entry.draft} onDelete={canDraft ? setDeleting : undefined} />
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <RecordLink href={`/liquidaciones-compra/${entry.document.id}`}>
                  {entry.document.documentNumber}
                </RecordLink>
                <span className="text-sm text-foreground-muted tabular-nums">
                  {formatIssueDate(entry.document.issueDate)}
                </span>
              </div>
              <span className="text-sm font-medium break-words">{entry.document.supplierName}</span>
              <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-foreground-muted tabular-nums">
                  {entry.document.supplierIdentification}
                </span>
                <MoneyCell amount={entry.document.total} />
              </span>
              <StateCell
                state={entry.document.state}
                stopped={entry.document.transmissionStopped}
              />
            </div>
          )
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Eliminar borrador"
        description={
          <p>
            Se elimina el borrador {deleting ? `"${draftName(deleting)}"` : ""}. No reserva nada: no
            consume números.
          </p>
        }
        confirmLabel="Eliminar borrador"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
      {creation.element}
    </DataTableCard>
  );
}

/** «Continuar» y, con permiso, «Eliminar borrador» (design D5). */
function DraftActions({
  draft,
  onDelete,
}: {
  draft: PurchaseSettlementDraftSummaryView;
  onDelete: ((draft: PurchaseSettlementDraftSummaryView) => void) | undefined;
}) {
  return (
    <RowActionsMenu
      label={`Acciones del borrador: ${draftName(draft)}`}
      actions={draftRowActions({
        editHref: draftHref(draft),
        onDelete: onDelete && (() => onDelete(draft)),
      })}
    />
  );
}

export function PurchaseSettlementsSkeleton() {
  return (
    <DataTableCard {...CARD} busy>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    </DataTableCard>
  );
}

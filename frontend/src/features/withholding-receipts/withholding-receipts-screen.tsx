// Retenciones (add-withholding-receipts, design D24). Usuario: administrador u operador. Objetivo:
// encontrar una retención y su estado. Decisión: qué retención abrir. Información mínima: número,
// proveedor, período fiscal, total retenido y estado. Acción principal: abrir la retención;
// secundaria: "Nueva retención". P0: número, estado y total retenido; P1: proveedor, período y
// fecha; P2: búsqueda y filtros de estado y período en la URL; P3 (identificadores): no se
// muestran. Los borradores van en la misma tabla, primero, con su estado «Borrador» filtrable
// (unify-drafts-into-document-lists, design D5).
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type EntryState,
  type WithholdingDraftSummaryView,
  type WithholdingReceiptEntryView,
} from "@facturador/contracts";
import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DataTableCard } from "@/components/data-table/data-table-card";
import { DataTableSelectFilter } from "@/components/data-table/data-table-select-filter";
import { RowActionsMenu } from "@/components/data-table/row-actions-menu";
import { SearchInput } from "@/components/data-table/table-controls";
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
import { formatPeriod, supportCountLabel, withholdingCountLabel } from "./withholding-format";
import {
  useDeleteWithholdingDraft,
  useWithholdingReceiptEntries,
} from "./withholding-receipts-api";

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

/** El período en la URL es `AAAA-MM`; la API recibe `MM/AAAA`. */
const PERIOD_PARAM = /^(20\d{2})-(0[1-9]|1[012])$/;
const periodOf = (param: string | null): string | undefined => {
  const match = PERIOD_PARAM.exec(param ?? "");
  return match ? `${match[2]}/${match[1]}` : undefined;
};
const periodParam = (period: string) => `${period.slice(3)}-${period.slice(0, 2)}`;

/** El mes de hoy y los once anteriores, del más reciente al más antiguo. */

const CARD = {
  title: "Retenciones",
  titleId: "retenciones-titulo",
  description: "Los comprobantes de retención que emites a tus proveedores.",
};
function recentPeriods(today = new Date()): string[] {
  return Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    return `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  });
}

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
  return {
    filter,
    period: periodOf(params.get("periodo")),
    page,
    pageSize,
    search: params.get("q") ?? "",
    update,
  };
}

const draftHref = (draft: WithholdingDraftSummaryView) => `/retenciones/borradores/${draft.id}`;
const draftParty = (draft: WithholdingDraftSummaryView) => draft.partyName ?? "Sin proveedor";
const entryId = (entry: WithholdingReceiptEntryView) =>
  entry.kind === "DRAFT" ? `borrador-${entry.draft.id}` : entry.document.id;

export function WithholdingReceiptsScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "withholdings.read");
  const canDraft = canSee(me.role, "withholdings.draft");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});
  const [deleting, setDeleting] = useState<WithholdingDraftSummaryView | null>(null);
  const remove = useDeleteWithholdingDraft({ onSuccess: () => setDeleting(null) });
  const periods = useMemo(() => {
    const recent = recentPeriods();
    return url.period && !recent.includes(url.period) ? [url.period, ...recent] : recent;
  }, [url.period]);

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const receipts = useWithholdingReceiptEntries(
    {
      search: url.search,
      state: STATE_FILTERS.find((filter) => filter.value === url.filter)?.state,
      fiscalPeriod: url.period,
      page: url.page,
      pageSize: url.pageSize,
    },
    allowed,
  );
  const forbidden = receipts.error instanceof ApiError && receipts.error.status === 403;
  const filtersActive = url.search !== "" || url.filter !== "todas" || url.period !== undefined;

  const columns = useMemo<ColumnDef<WithholdingReceiptEntryView, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Número",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <RecordLink href={draftHref(row.original.draft)}>Borrador</RecordLink>
          ) : (
            <RecordLink href={`/retenciones/${row.original.document.id}`}>
              {row.original.document.documentNumber}
            </RecordLink>
          ),
      },
      {
        id: "subject",
        header: "Proveedor",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <DraftParty name={row.original.draft.partyName} missing="Sin proveedor" />
          ) : (
            <PartyCell
              name={row.original.document.subjectName}
              identification={row.original.document.subjectIdentification}
            />
          ),
      },
      {
        id: "period",
        header: "Período fiscal",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <span className="flex flex-col">
              {row.original.draft.fiscalPeriod ? (
                <span>{formatPeriod(row.original.draft.fiscalPeriod)}</span>
              ) : (
                <MutedCell>Sin período</MutedCell>
              )}
              <span className="text-xs text-foreground-muted">
                {supportCountLabel(row.original.draft.supportCount)} ·{" "}
                {withholdingCountLabel(row.original.draft.withholdingCount)}
              </span>
            </span>
          ) : (
            <span className="flex flex-col">
              <span>{formatPeriod(row.original.document.fiscalPeriod)}</span>
              <span className="text-xs text-foreground-muted">
                {supportCountLabel(row.original.document.supportCount)}
              </span>
            </span>
          ),
      },
      {
        id: "total",
        header: () => <span className="block text-right">Total retenido</span>,
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
            title="No tienes acceso a Retenciones"
            description="Pide a un administrador que revise tu rol."
          />
        </div>
      </DataTableCard>
    );
  }

  // La acción va en el encabezado como principal; el estado vacío la repite en `outline`, sin una
  // segunda principal (productize-invoice-editor-and-composition-foundation, design D11).
  const newReceipt = (variant: "primary" | "outline", size: "default" | "sm" = "default") =>
    canDraft ? (
      <Button asChild variant={variant} size={size}>
        <Link href="/retenciones/borradores/nueva">
          <Plus aria-hidden="true" />
          Nueva retención
        </Link>
      </Button>
    ) : null;
  const tableState = receipts.isError ? (
    <ErrorState
      message="No pudimos cargar las retenciones."
      onRetry={() => void receipts.refetch()}
    />
  ) : receipts.data && receipts.data.data.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay retenciones que coincidan"
        description="Prueba con otro número o proveedor, o quita los filtros."
        action={
          <Button
            variant="outline"
            onClick={() => {
              setSearchDraft("");
              url.update({ q: null, estado: null, periodo: null });
            }}
          >
            Limpiar filtros
          </Button>
        }
      />
    ) : (
      <EmptyState
        kind="empty"
        title="Todavía no hay retenciones"
        description="Un comprobante de retención acredita la renta y el IVA que retuviste a un proveedor sobre sus facturas, notas de venta o liquidaciones de compra."
        action={newReceipt("outline") ?? undefined}
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
      actions={newReceipt("primary", "sm")}
      filters={
        <>
          <DataTableSelectFilter
            label="Período fiscal"
            value={url.period ? periodParam(url.period) : undefined}
            allLabel="Todos"
            options={periods.map((period) => ({
              value: periodParam(period),
              label: formatPeriod(period),
            }))}
            onChange={(next) => url.update({ periodo: next ?? null })}
          />
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
        label="Retenciones y borradores"
        columns={columns}
        data={receipts.data?.data ?? []}
        getRowId={entryId}
        total={receipts.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={receipts.isPending}
        refreshing={receipts.isFetching}
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
                <DraftParty name={entry.draft.partyName} missing="Sin proveedor" />
              </span>
              <span className="text-sm text-foreground-muted">
                {entry.draft.fiscalPeriod ? formatPeriod(entry.draft.fiscalPeriod) : "Sin período"}{" "}
                · {supportCountLabel(entry.draft.supportCount)} ·{" "}
                {withholdingCountLabel(entry.draft.withholdingCount)}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <DraftStateBadge />
                <DraftActions draft={entry.draft} onDelete={canDraft ? setDeleting : undefined} />
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <RecordLink href={`/retenciones/${entry.document.id}`}>
                  {entry.document.documentNumber}
                </RecordLink>
                <MoneyCell amount={entry.document.total} />
              </div>
              <span className="text-sm font-medium break-words">{entry.document.subjectName}</span>
              <span className="text-sm text-foreground-muted">
                {formatPeriod(entry.document.fiscalPeriod)} ·{" "}
                {supportCountLabel(entry.document.supportCount)} ·{" "}
                {formatIssueDate(entry.document.issueDate)}
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
            Se elimina el borrador de la retención a {deleting ? draftParty(deleting) : ""}. No
            reserva nada: no consume números.
          </p>
        }
        confirmLabel="Eliminar borrador"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </DataTableCard>
  );
}

/** «Continuar» y, con permiso, «Eliminar borrador» (design D5). */
function DraftActions({
  draft,
  onDelete,
}: {
  draft: WithholdingDraftSummaryView;
  onDelete: ((draft: WithholdingDraftSummaryView) => void) | undefined;
}) {
  return (
    <RowActionsMenu
      label={`Acciones del borrador de la retención a ${draftParty(draft)}`}
      actions={draftRowActions({
        editHref: draftHref(draft),
        onDelete: onDelete && (() => onDelete(draft)),
      })}
    />
  );
}

export function WithholdingReceiptsSkeleton() {
  return (
    <DataTableCard {...CARD} busy>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    </DataTableCard>
  );
}

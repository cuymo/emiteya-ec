// Notas de débito (add-debit-notes, design D23). Usuario: administrador u operador. Objetivo:
// encontrar una nota y su estado. Decisión: qué nota abrir. Información mínima: número, factura
// modificada, causas, comprador, valor total y estado. Acción principal: abrir la nota; secundaria:
// "Nueva nota de débito". P0: número, estado y valor; P1: factura, comprador, causas y fecha; P2:
// búsqueda y filtros; P3 (identificadores): no se muestran. Los borradores van en la misma tabla,
// primero, con su estado «Borrador» filtrable (unify-drafts-into-document-lists, design D5).
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  DEBIT_NOTE_CAUSES,
  DEBIT_NOTE_CAUSE_LABELS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type DebitNoteCause,
  type DebitNoteDraftSummaryView,
  type DebitNoteEntryView,
  type EntryState,
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
  draftRowActions,
} from "@/features/documents/draft-entries";
import { useDebitNoteEntries, useDeleteDebitNoteDraft } from "./debit-notes-api";

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
/** La causa en la URL: `intereses` o `costos`. */
const CAUSE_PARAMS: Record<DebitNoteCause, string> = {
  LATE_PAYMENT_INTEREST: "intereses",
  POST_INVOICE_COST_EXPENSE: "costos",
};
const causeOf = (param: string | null): DebitNoteCause | undefined =>
  DEBIT_NOTE_CAUSES.find((cause) => CAUSE_PARAMS[cause] === param);

/** Las causas de los conceptos de la nota, en el orden del enum. */
const causesLabel = (causes: readonly DebitNoteCause[]) =>
  causes.map((cause) => DEBIT_NOTE_CAUSE_LABELS[cause]).join(" · ");
const conceptCount = (count: number) => (count === 1 ? "1 concepto" : `${count} conceptos`);

const CARD = {
  title: "Notas de débito",
  titleId: "notas-titulo",
  description: "Las notas de débito que cobran intereses o costos posteriores a una factura.",
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
  return {
    filter,
    cause: causeOf(params.get("causa")),
    page,
    pageSize,
    search: params.get("q") ?? "",
    update,
  };
}

const draftHref = (draft: DebitNoteDraftSummaryView) => `/notas-debito/borradores/${draft.id}`;
const entryId = (entry: DebitNoteEntryView) =>
  entry.kind === "DRAFT" ? `borrador-${entry.draft.id}` : entry.document.id;

export function DebitNotesScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "debitNotes.read");
  const canDraft = canSee(me.role, "debitNotes.draft");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});
  const [deleting, setDeleting] = useState<DebitNoteDraftSummaryView | null>(null);
  const remove = useDeleteDebitNoteDraft({ onSuccess: () => setDeleting(null) });

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const notes = useDebitNoteEntries(
    {
      search: url.search,
      state: STATE_FILTERS.find((filter) => filter.value === url.filter)?.state,
      cause: url.cause,
      page: url.page,
      pageSize: url.pageSize,
    },
    allowed,
  );
  const forbidden = notes.error instanceof ApiError && notes.error.status === 403;
  const filtersActive = url.search !== "" || url.filter !== "todas" || url.cause !== undefined;

  const columns = useMemo<ColumnDef<DebitNoteEntryView, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Número",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <RecordLink href={draftHref(row.original.draft)}>Borrador</RecordLink>
          ) : (
            <RecordLink href={`/notas-debito/${row.original.document.id}`}>
              {row.original.document.documentNumber}
            </RecordLink>
          ),
      },
      {
        id: "invoice",
        header: "Factura",
        cell: ({ row }) => (
          <MutedCell>
            {row.original.kind === "DRAFT"
              ? row.original.draft.invoice.documentNumber
              : row.original.document.invoice.documentNumber}
          </MutedCell>
        ),
      },
      {
        id: "causes",
        header: "Causas",
        // El resumen del borrador no trae las causas de sus conceptos.
        cell: ({ row }) => (
          <MutedCell>
            {row.original.kind === "DRAFT" ? "—" : causesLabel(row.original.document.causes)}
          </MutedCell>
        ),
      },
      {
        id: "buyer",
        header: "Comprador",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <PartyCell name={row.original.draft.buyerName} />
          ) : (
            <PartyCell
              name={row.original.document.buyerName}
              identification={row.original.document.buyerIdentification}
            />
          ),
      },
      {
        id: "total",
        header: () => <span className="block text-right">Valor</span>,
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
            title="No tienes acceso a Notas de débito"
            description="Pide a un administrador que revise tu rol."
          />
        </div>
      </DataTableCard>
    );
  }

  // La acción va en el encabezado como principal; el estado vacío la repite en `outline`, sin una
  // segunda principal (productize-invoice-editor-and-composition-foundation, design D11).
  const newNote = (variant: "primary" | "outline", size: "default" | "sm" = "default") =>
    canDraft ? (
      <Button asChild variant={variant} size={size}>
        <Link href="/notas-debito/borradores/nueva">
          <Plus aria-hidden="true" />
          Nueva nota de débito
        </Link>
      </Button>
    ) : null;
  const tableState = notes.isError ? (
    <ErrorState
      message="No pudimos cargar las notas de débito."
      onRetry={() => void notes.refetch()}
    />
  ) : notes.data && notes.data.data.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay notas que coincidan"
        description="Prueba con otro número o comprador, o quita los filtros."
        action={
          <Button
            variant="outline"
            onClick={() => {
              setSearchDraft("");
              url.update({ q: null, estado: null, causa: null });
            }}
          >
            Limpiar filtros
          </Button>
        }
      />
    ) : (
      <EmptyState
        kind="empty"
        title="Todavía no hay notas de débito"
        description="Una nota de débito cobra, después de una factura autorizada, intereses de mora o costos y gastos posteriores a ella."
        action={newNote("outline") ?? undefined}
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
          label="Buscar por número o comprador"
          placeholder="Número o comprador"
        />
      }
      actions={newNote("primary", "sm")}
      filters={
        <>
          <DataTableSelectFilter
            label="Causa"
            value={url.cause ? CAUSE_PARAMS[url.cause] : undefined}
            allLabel="Todas"
            options={DEBIT_NOTE_CAUSES.map((cause) => ({
              value: CAUSE_PARAMS[cause],
              label: DEBIT_NOTE_CAUSE_LABELS[cause],
            }))}
            onChange={(next) => url.update({ causa: next ?? null })}
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
        label="Notas de débito y borradores"
        columns={columns}
        data={notes.data?.data ?? []}
        getRowId={entryId}
        total={notes.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={notes.isPending}
        refreshing={notes.isFetching}
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
              <span className="text-sm font-medium break-words">{entry.draft.buyerName}</span>
              <span className="text-sm text-foreground-muted">
                {conceptCount(entry.draft.conceptCount)} · Factura{" "}
                <span className="whitespace-nowrap tabular-nums">
                  {entry.draft.invoice.documentNumber}
                </span>
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <DraftStateBadge />
                <DraftActions draft={entry.draft} onDelete={canDraft ? setDeleting : undefined} />
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <RecordLink href={`/notas-debito/${entry.document.id}`}>
                  {entry.document.documentNumber}
                </RecordLink>
                <MoneyCell amount={entry.document.total} />
              </div>
              <span className="text-sm font-medium break-words">{entry.document.buyerName}</span>
              <span className="text-sm text-foreground-muted">
                {causesLabel(entry.document.causes)} · Factura{" "}
                <span className="whitespace-nowrap tabular-nums">
                  {entry.document.invoice.documentNumber}
                </span>{" "}
                · {formatIssueDate(entry.document.issueDate)}
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
            Se elimina el borrador de la factura {deleting?.invoice.documentNumber}. No reserva
            nada: no consume números ni cambia la factura.
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
  draft: DebitNoteDraftSummaryView;
  onDelete: ((draft: DebitNoteDraftSummaryView) => void) | undefined;
}) {
  return (
    <RowActionsMenu
      label={`Acciones del borrador de la factura ${draft.invoice.documentNumber}`}
      actions={draftRowActions({
        editHref: draftHref(draft),
        onDelete: onDelete && (() => onDelete(draft)),
      })}
    />
  );
}

export function DebitNotesSkeleton() {
  return (
    <DataTableCard {...CARD} busy>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    </DataTableCard>
  );
}

// Notas de crédito (add-credit-notes, design D19). Usuario: administrador u operador. Objetivo:
// encontrar una nota y su estado. Decisión: qué nota abrir. Información mínima: número, factura
// modificada, causa, comprador, valor y estado. Acción principal: abrir la nota; secundaria: "Nueva
// nota de crédito". P0: número, estado y valor; P1: factura, causa, comprador y fecha; P2: búsqueda,
// filtros y los borradores en curso; P3 (identificadores): no se muestran.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  CREDIT_NOTE_CAUSES,
  CREDIT_NOTE_CAUSE_LABELS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type CreditNoteCause,
  type CreditNoteDraftSummaryView,
  type CreditNoteSummaryView,
  type InvoiceState,
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
import { Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { formatDateTime, formatIssueDate } from "@/features/invoices/invoice-format";
import { StateCell } from "@/features/documents/document-status-badge";
import { useCreditNoteDrafts, useCreditNotes, useDeleteCreditNoteDraft } from "./credit-notes-api";

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
/** La causa en la URL: `anulacion` o `devolucion`. */
const CAUSE_PARAMS: Record<CreditNoteCause, string> = {
  TOTAL_ANNULMENT: "anulacion",
  RETURN: "devolucion",
};
const causeOf = (param: string | null): CreditNoteCause | undefined =>
  CREDIT_NOTE_CAUSES.find((cause) => CAUSE_PARAMS[cause] === param);

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

/** Borradores en curso: se abren para seguir editándolos o se eliminan. */
function DraftsPanel() {
  const headingId = useId();
  const drafts = useCreditNoteDrafts({ page: 1, pageSize: 10 }, true);
  const [deleting, setDeleting] = useState<CreditNoteDraftSummaryView | null>(null);
  const remove = useDeleteCreditNoteDraft({ onSuccess: () => setDeleting(null) });
  if (drafts.isPending || drafts.isError || drafts.data.data.length === 0) return null;
  const { data, meta } = drafts.data;
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
                href={`/notas-credito/borradores/${draft.id}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {CREDIT_NOTE_CAUSE_LABELS[draft.cause]} de la factura{" "}
                <span className="whitespace-nowrap tabular-nums">
                  {draft.invoice.documentNumber}
                </span>
              </Link>
              <span className="text-foreground-muted break-words">
                {draft.buyerName} ·{" "}
                {draft.previewTotal ? formatUsd(draft.previewTotal) : "Sin calcular"} ·{" "}
                {formatDateTime(draft.updatedAt)}
              </span>
            </span>
            <RowActionButton
              icon={Trash2}
              label={`Eliminar el borrador de la factura ${draft.invoice.documentNumber}`}
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
            Se elimina el borrador de la factura {deleting?.invoice.documentNumber}. No reserva
            nada, así que no afecta al crédito de la factura.
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

export function CreditNotesScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "creditNotes.read");
  const canDraft = canSee(me.role, "creditNotes.draft");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const notes = useCreditNotes(
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

  const columns = useMemo<ColumnDef<CreditNoteSummaryView, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Número",
        cell: ({ row }) => (
          <Link
            href={`/notas-credito/${row.original.id}`}
            className="font-medium tabular-nums underline-offset-2 hover:underline"
          >
            {row.original.documentNumber}
          </Link>
        ),
      },
      {
        id: "invoice",
        header: "Factura",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.invoice.documentNumber}</span>
        ),
      },
      {
        id: "cause",
        header: "Causa",
        cell: ({ row }) => CREDIT_NOTE_CAUSE_LABELS[row.original.cause],
      },
      {
        id: "buyer",
        header: "Comprador",
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="break-words">{row.original.buyerName}</span>
            <span className="text-xs text-foreground-muted tabular-nums">
              {row.original.buyerIdentification}
            </span>
          </span>
        ),
      },
      {
        id: "total",
        header: () => <span className="block text-right">Valor</span>,
        cell: ({ row }) => (
          <span className="block text-right tabular-nums">{formatUsd(row.original.total)}</span>
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
    <h1 id="notas-titulo" className="text-3xl font-bold">
      Notas de crédito
    </h1>
  );
  if (!allowed || forbidden) {
    return (
      <section aria-labelledby="notas-titulo" className="flex flex-col gap-6">
        {title}
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a Notas de crédito"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }

  const newNote = canDraft ? (
    <Button asChild>
      <Link href="/notas-credito/borradores/nueva">
        <Plus aria-hidden="true" />
        Nueva nota de crédito
      </Link>
    </Button>
  ) : null;
  const tableState = notes.isError ? (
    <ErrorState
      message="No pudimos cargar las notas de crédito."
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
        title="Todavía no hay notas de crédito"
        description="Una nota de crédito corrige una factura autorizada: la anula por completo o registra una devolución."
        action={newNote ?? undefined}
      />
    )
  ) : undefined;

  return (
    <section aria-labelledby="notas-titulo" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {title}
        {newNote}
      </div>
      {canDraft && <DraftsPanel />}
      <AppDataTable
        label="Notas de crédito emitidas"
        columns={columns}
        data={notes.data?.data ?? []}
        getRowId={(note) => note.id}
        total={notes.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={notes.isPending}
        refreshing={notes.isFetching}
        state={tableState}
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-4">
              <SearchInput
                value={searchDraft}
                onChange={setSearchDraft}
                label="Buscar por número o comprador"
                placeholder="Número o comprador"
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor="filtro-causa">Causa</Label>
                <Select
                  id="filtro-causa"
                  value={url.cause ? CAUSE_PARAMS[url.cause] : ""}
                  onChange={(event) => url.update({ causa: event.target.value })}
                >
                  <option value="">Todas</option>
                  {CREDIT_NOTE_CAUSES.map((cause) => (
                    <option key={cause} value={CAUSE_PARAMS[cause]}>
                      {CREDIT_NOTE_CAUSE_LABELS[cause]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <ChipGroup
              label="Estado"
              value={url.filter}
              options={STATE_FILTERS}
              onChange={(value) => url.update({ estado: value === "todas" ? null : value })}
            />
          </div>
        }
        renderCard={(note) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/notas-credito/${note.id}`}
                className="font-medium tabular-nums underline-offset-2 hover:underline"
              >
                {note.documentNumber}
              </Link>
              <span className="tabular-nums">{formatUsd(note.total)}</span>
            </div>
            <span className="text-sm break-words">{note.buyerName}</span>
            <span className="text-sm text-foreground-muted">
              {CREDIT_NOTE_CAUSE_LABELS[note.cause]} · Factura{" "}
              <span className="whitespace-nowrap tabular-nums">{note.invoice.documentNumber}</span>{" "}
              · {formatIssueDate(note.issueDate)}
            </span>
            <StateCell state={note.state} stopped={note.transmissionStopped} />
          </div>
        )}
      />
    </section>
  );
}

export function CreditNotesSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Notas de crédito</h1>
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-64 w-full" />
    </section>
  );
}

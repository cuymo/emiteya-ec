// Notas de débito (add-debit-notes, design D23). Usuario: administrador u operador. Objetivo:
// encontrar una nota y su estado. Decisión: qué nota abrir. Información mínima: número, factura
// modificada, causas, comprador, valor total y estado. Acción principal: abrir la nota; secundaria:
// "Nueva nota de débito". P0: número, estado y valor; P1: factura, comprador, causas y fecha; P2:
// búsqueda, filtros y los borradores en curso; P3 (identificadores): no se muestran.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  DEBIT_NOTE_CAUSES,
  DEBIT_NOTE_CAUSE_LABELS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type DebitNoteCause,
  type DebitNoteDraftSummaryView,
  type DebitNoteSummaryView,
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
import { StateCell } from "@/features/invoices/invoices-screen";
import { useDebitNoteDrafts, useDebitNotes, useDeleteDebitNoteDraft } from "./debit-notes-api";

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
  const drafts = useDebitNoteDrafts({ page: 1, pageSize: 10 }, true);
  const [deleting, setDeleting] = useState<DebitNoteDraftSummaryView | null>(null);
  const remove = useDeleteDebitNoteDraft({ onSuccess: () => setDeleting(null) });
  if (drafts.isPending || drafts.isError || drafts.data.data.length === 0) return null;
  const { data, meta } = drafts.data;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="text-lg font-semibold">
        Borradores en curso
      </h2>
      <ul className="flex flex-col gap-0.5">
        {data.map((draft) => (
          <li
            key={draft.id}
            className="flex flex-wrap items-center justify-between gap-1 rounded-md border border-border bg-surface px-1.5 py-1 text-sm"
          >
            <span className="flex min-w-0 flex-col">
              <Link
                href={`/notas-debito/borradores/${draft.id}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                Nota de débito de la factura{" "}
                <span className="whitespace-nowrap tabular-nums">
                  {draft.invoice.documentNumber}
                </span>
              </Link>
              <span className="text-foreground-muted break-words">
                {draft.buyerName} · {conceptCount(draft.conceptCount)} ·{" "}
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
            nada: no consume números ni cambia la factura.
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

export function DebitNotesScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "debitNotes.read");
  const canDraft = canSee(me.role, "debitNotes.draft");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const notes = useDebitNotes(
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

  const columns = useMemo<ColumnDef<DebitNoteSummaryView, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Número",
        cell: ({ row }) => (
          <Link
            href={`/notas-debito/${row.original.id}`}
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
        id: "causes",
        header: "Causas",
        cell: ({ row }) => causesLabel(row.original.causes),
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
      Notas de débito
    </h1>
  );
  if (!allowed || forbidden) {
    return (
      <section aria-labelledby="notas-titulo" className="flex flex-col gap-3">
        {title}
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a Notas de débito"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }

  const newNote = canDraft ? (
    <Button asChild>
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
        action={newNote ?? undefined}
      />
    )
  ) : undefined;

  return (
    <section aria-labelledby="notas-titulo" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {title}
        {newNote}
      </div>
      {canDraft && <DraftsPanel />}
      <AppDataTable
        label="Notas de débito emitidas"
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
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-end gap-2">
              <SearchInput
                value={searchDraft}
                onChange={setSearchDraft}
                label="Buscar por número o comprador"
                placeholder="Número o comprador"
              />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="filtro-causa">Causa</Label>
                <Select
                  id="filtro-causa"
                  value={url.cause ? CAUSE_PARAMS[url.cause] : ""}
                  onChange={(event) => url.update({ causa: event.target.value })}
                >
                  <option value="">Todas</option>
                  {DEBIT_NOTE_CAUSES.map((cause) => (
                    <option key={cause} value={CAUSE_PARAMS[cause]}>
                      {DEBIT_NOTE_CAUSE_LABELS[cause]}
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
          <div className="flex flex-col gap-1">
            <div className="flex items-start justify-between gap-1">
              <Link
                href={`/notas-debito/${note.id}`}
                className="font-medium tabular-nums underline-offset-2 hover:underline"
              >
                {note.documentNumber}
              </Link>
              <span className="tabular-nums">{formatUsd(note.total)}</span>
            </div>
            <span className="text-sm break-words">{note.buyerName}</span>
            <span className="text-sm text-foreground-muted">
              {causesLabel(note.causes)} · Factura{" "}
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

export function DebitNotesSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-3">
      <h1 className="text-3xl font-bold">Notas de débito</h1>
      <Skeleton className="h-5 w-full max-w-md" />
      <Skeleton className="h-32 w-full" />
    </section>
  );
}

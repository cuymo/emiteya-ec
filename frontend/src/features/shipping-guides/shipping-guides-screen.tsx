// Guías de remisión (add-shipping-guides, design D25). Usuario: administrador u operador. Objetivo:
// encontrar una guía y su estado. Decisión: qué guía abrir. Información mínima: número,
// destinatarios, transportista, fechas del transporte y estado. Acción principal: abrir la guía;
// secundaria: "Nueva guía de remisión". P0: número y estado; P1: destinatarios ("N destinatarios" o
// el nombre), transportista y fecha de inicio; P2: búsqueda y filtro de estado en la URL y fecha de
// fin; P3 (identificadores): no se muestran. Los borradores van en la misma tabla, primero, con su
// estado «Borrador» filtrable (unify-drafts-into-document-lists, design D5).
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type EntryState,
  type ShippingGuideDraftSummaryView,
  type ShippingGuideEntryView,
  type ShippingGuideSummaryView,
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
import { MutedCell, RecordLink } from "@/components/data-table/data-table-cells";
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
import { useNewShippingGuide } from "./new-shipping-guide";
import { detailCountLabel, recipientCountLabel } from "./shipping-guide-format";
import { useDeleteShippingGuideDraft, useShippingGuideEntries } from "./shipping-guides-api";

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
  title: "Guías de remisión",
  titleId: "guias-titulo",
  description: "Las guías que acompañan el traslado de tus mercaderías.",
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

/** "María Pérez" o "3 destinatarios": nunca un destinatario como receptor único. */
const recipientsText = (guide: ShippingGuideSummaryView) =>
  guide.recipients.name ?? recipientCountLabel(guide.recipients.count);

/** Un borrador puede no tener destinatarios todavía. */
const draftRecipientsText = (draft: ShippingGuideDraftSummaryView) =>
  draft.recipientCount === 0 ? "Sin destinatarios" : recipientCountLabel(draft.recipientCount);

/** "Guía con TRANSPORTES ANDINOS S.A." o "Guía sin transportista": un borrador no tiene número. */
const draftName = (draft: ShippingGuideDraftSummaryView) =>
  draft.carrierName ? `Guía con ${draft.carrierName}` : "Guía sin transportista";

const draftHref = (draft: ShippingGuideDraftSummaryView) =>
  `/guias-remision/borradores/${draft.id}`;
const entryId = (entry: ShippingGuideEntryView) =>
  entry.kind === "DRAFT" ? `borrador-${entry.draft.id}` : entry.document.id;

export function ShippingGuidesScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "shippingGuides.read");
  const canDraft = canSee(me.role, "shippingGuides.draft");
  // «Nueva guía de remisión» se abre sobre la lista, sin una página intermedia (decisión del propietario,
  // 2026-10-22).
  const creation = useNewShippingGuide(canDraft);
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});
  const [deleting, setDeleting] = useState<ShippingGuideDraftSummaryView | null>(null);
  const remove = useDeleteShippingGuideDraft({ onSuccess: () => setDeleting(null) });

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const guides = useShippingGuideEntries(
    {
      search: url.search,
      state: STATE_FILTERS.find((filter) => filter.value === url.filter)?.state,
      page: url.page,
      pageSize: url.pageSize,
    },
    allowed,
  );
  const forbidden = guides.error instanceof ApiError && guides.error.status === 403;
  const filtersActive = url.search !== "" || url.filter !== "todas";

  const columns = useMemo<ColumnDef<ShippingGuideEntryView, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Número",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <RecordLink href={draftHref(row.original.draft)}>Borrador</RecordLink>
          ) : (
            <RecordLink href={`/guias-remision/${row.original.document.id}`}>
              {row.original.document.documentNumber}
            </RecordLink>
          ),
      },
      {
        id: "recipients",
        header: "Destinatarios",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            <MutedCell>{draftRecipientsText(row.original.draft)}</MutedCell>
          ) : (
            <span className="font-medium break-words">{recipientsText(row.original.document)}</span>
          ),
      },
      {
        id: "carrier",
        header: "Transportista",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            // Como en las guías emitidas, el transportista es contexto: atenuado.
            <MutedCell className="break-words">
              {row.original.draft.carrierName ?? "Sin transportista"}
            </MutedCell>
          ) : (
            <MutedCell className="break-words">{row.original.document.carrierName}</MutedCell>
          ),
      },
      {
        id: "transport",
        header: "Transporte",
        cell: ({ row }) =>
          row.original.kind === "DRAFT" ? (
            // El borrador muestra su inicio, si ya lo tiene, y cuándo se editó por última vez.
            <span className="flex flex-col text-foreground-muted tabular-nums">
              {row.original.draft.transportStart && (
                <span>Inicio {formatIssueDate(row.original.draft.transportStart)}</span>
              )}
              <DraftEditedAt updatedAt={row.original.draft.updatedAt} />
            </span>
          ) : (
            <span className="flex flex-col text-foreground-muted tabular-nums">
              <span>Inicio {formatIssueDate(row.original.document.transportStart)}</span>
              <span className="text-xs text-foreground-muted">
                Fin {formatIssueDate(row.original.document.transportEnd)}
              </span>
            </span>
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
            title="No tienes acceso a Guías de remisión"
            description="Pide a un administrador que revise tu rol."
          />
        </div>
      </DataTableCard>
    );
  }

  // La acción va en el encabezado como principal; el estado vacío la repite en `outline`, sin una
  // segunda principal (productize-invoice-editor-and-composition-foundation, design D11).
  const newGuide = (variant: "primary" | "outline", size: "default" | "sm" = "default") =>
    canDraft ? (
      <AsyncButton
        variant={variant}
        size={size}
        pending={creation.pending}
        onClick={creation.start}
      >
        <Plus aria-hidden="true" />
        Nueva guía de remisión
      </AsyncButton>
    ) : null;
  const tableState = guides.isError ? (
    <ErrorState
      message="No pudimos cargar las guías de remisión."
      onRetry={() => void guides.refetch()}
    />
  ) : guides.data && guides.data.data.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay guías que coincidan"
        description="Prueba con otro número, transportista o identificación de un destinatario, o quita los filtros."
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
        title="Todavía no hay guías de remisión"
        description="Una guía de remisión sustenta el traslado de mercadería dentro del país: quién la transporta, en qué vehículo, desde dónde y hacia qué destinatarios."
        action={newGuide("outline") ?? undefined}
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
          label="Buscar por número, transportista o destinatario"
          placeholder="Número o identificación"
        />
      }
      actions={newGuide("primary", "sm")}
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
        label="Guías de remisión y borradores"
        columns={columns}
        data={guides.data?.data ?? []}
        getRowId={entryId}
        total={guides.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={guides.isPending}
        refreshing={guides.isFetching}
        state={tableState}
        renderCard={(entry) =>
          entry.kind === "DRAFT" ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <RecordLink href={draftHref(entry.draft)}>Borrador</RecordLink>
                <DraftEditedAt updatedAt={entry.draft.updatedAt} />
              </div>
              <span className="text-sm">
                <DraftParty name={entry.draft.carrierName} missing="Sin transportista" />
              </span>
              <span className="text-sm text-foreground-muted break-words">
                {draftRecipientsText(entry.draft)} · {detailCountLabel(entry.draft.detailCount)}
                {entry.draft.transportStart &&
                  ` · Inicio ${formatIssueDate(entry.draft.transportStart)}`}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <DraftStateBadge />
                <DraftActions draft={entry.draft} onDelete={canDraft ? setDeleting : undefined} />
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <RecordLink href={`/guias-remision/${entry.document.id}`}>
                  {entry.document.documentNumber}
                </RecordLink>
                <span className="text-sm text-foreground-muted tabular-nums">
                  {formatIssueDate(entry.document.transportStart)}
                </span>
              </div>
              <span className="text-sm font-medium break-words">
                {recipientsText(entry.document)}
              </span>
              <span className="text-sm text-foreground-muted break-words">
                {entry.document.carrierName} · Fin {formatIssueDate(entry.document.transportEnd)}
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
  draft: ShippingGuideDraftSummaryView;
  onDelete: ((draft: ShippingGuideDraftSummaryView) => void) | undefined;
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

export function ShippingGuidesSkeleton() {
  return (
    <DataTableCard {...CARD} busy>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    </DataTableCard>
  );
}

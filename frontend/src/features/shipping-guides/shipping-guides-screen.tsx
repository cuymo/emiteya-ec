// Guías de remisión (add-shipping-guides, design D25). Usuario: administrador u operador. Objetivo:
// encontrar una guía y su estado. Decisión: qué guía abrir. Información mínima: número,
// destinatarios, transportista, fechas del transporte y estado. Acción principal: abrir la guía;
// secundaria: "Nueva guía de remisión". P0: número y estado; P1: destinatarios ("N destinatarios" o
// el nombre), transportista y fecha de inicio; P2: búsqueda y filtro de estado en la URL, fecha de
// fin y los borradores en curso; P3 (identificadores): no se muestran.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type InvoiceState,
  type ShippingGuideDraftSummaryView,
  type ShippingGuideSummaryView,
} from "@facturador/contracts";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DataTableCard } from "@/components/data-table/data-table-card";
import { DataTableSelectFilter } from "@/components/data-table/data-table-select-filter";
import { RowActionButton, SearchInput } from "@/components/data-table/table-controls";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { formatDateTime, formatIssueDate } from "@/features/invoices/invoice-format";
import { StateCell } from "@/features/documents/document-status-badge";
import { detailCountLabel, recipientCountLabel } from "./shipping-guide-format";
import {
  useDeleteShippingGuideDraft,
  useShippingGuideDrafts,
  useShippingGuides,
} from "./shipping-guides-api";

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

/** Borradores en curso: se abren para seguir editándolos o se eliminan. */
function DraftsPanel() {
  const headingId = useId();
  const drafts = useShippingGuideDrafts({ page: 1, pageSize: 10 }, true);
  const [deleting, setDeleting] = useState<ShippingGuideDraftSummaryView | null>(null);
  const remove = useDeleteShippingGuideDraft({ onSuccess: () => setDeleting(null) });
  if (drafts.isPending || drafts.isError || drafts.data.data.length === 0) return null;
  const { data, meta } = drafts.data;
  const nameOf = (draft: ShippingGuideDraftSummaryView) =>
    draft.carrierName ? `Guía con ${draft.carrierName}` : "Guía sin transportista";
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
                href={`/guias-remision/borradores/${draft.id}`}
                className="font-medium break-words underline-offset-2 hover:underline"
              >
                {nameOf(draft)}
              </Link>
              <span className="text-foreground-muted break-words">
                {recipientCountLabel(draft.recipientCount)} · {detailCountLabel(draft.detailCount)}{" "}
                ·{" "}
                {draft.transportStart
                  ? `Desde el ${formatIssueDate(draft.transportStart)}`
                  : "Sin fecha de inicio"}{" "}
                · {formatDateTime(draft.updatedAt)}
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

export function ShippingGuidesScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "shippingGuides.read");
  const canDraft = canSee(me.role, "shippingGuides.draft");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const guides = useShippingGuides(
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

  const columns = useMemo<ColumnDef<ShippingGuideSummaryView, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Número",
        cell: ({ row }) => (
          <Link
            href={`/guias-remision/${row.original.id}`}
            className="font-medium whitespace-nowrap tabular-nums underline-offset-2 hover:underline"
          >
            {row.original.documentNumber}
          </Link>
        ),
      },
      {
        id: "recipients",
        header: "Destinatarios",
        cell: ({ row }) => <span className="break-words">{recipientsText(row.original)}</span>,
      },
      {
        id: "carrier",
        header: "Transportista",
        cell: ({ row }) => <span className="break-words">{row.original.carrierName}</span>,
      },
      {
        id: "transport",
        header: "Transporte",
        cell: ({ row }) => (
          <span className="flex flex-col tabular-nums">
            <span>Inicio {formatIssueDate(row.original.transportStart)}</span>
            <span className="text-xs text-foreground-muted">
              Fin {formatIssueDate(row.original.transportEnd)}
            </span>
          </span>
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
      <Button asChild variant={variant} size={size}>
        <Link href="/guias-remision/borradores/nueva">
          <Plus aria-hidden="true" />
          Nueva guía de remisión
        </Link>
      </Button>
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
      lead={canDraft ? <DraftsPanel /> : undefined}
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
        label="Guías de remisión emitidas"
        columns={columns}
        data={guides.data?.data ?? []}
        getRowId={(guide) => guide.id}
        total={guides.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={guides.isPending}
        refreshing={guides.isFetching}
        state={tableState}
        renderCard={(guide) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/guias-remision/${guide.id}`}
                className="font-medium whitespace-nowrap tabular-nums underline-offset-2 hover:underline"
              >
                {guide.documentNumber}
              </Link>
              <span className="text-sm text-foreground-muted tabular-nums">
                {formatIssueDate(guide.transportStart)}
              </span>
            </div>
            <span className="text-sm break-words">{recipientsText(guide)}</span>
            <span className="text-sm text-foreground-muted break-words">
              {guide.carrierName} · Fin {formatIssueDate(guide.transportEnd)}
            </span>
            <StateCell state={guide.state} stopped={guide.transmissionStopped} />
          </div>
        )}
      />
    </DataTableCard>
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

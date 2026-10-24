// Facturas (add-invoice-emission, design D15; add-sri-transmission, design D20; productize-invoice-
// list-and-shared-table-foundation, design D4 a D15). Usuario: administrador u operador, a diario.
// Objetivo: encontrar una factura, saber en qué estado está, atender lo que espera una intervención y
// empezar una nueva. Decisión: cuál factura abrir o atender. Información mínima: número, estado,
// comprador, total y fecha. Acción principal: «Nueva factura»; en cada fila, abrir la factura.
// P0: título, «Nueva factura», el número de «Requiere atención», y el número y el estado de cada
// fila. P1: comprador, total, fecha, búsqueda, vistas, estado, transmisión detenida y ambiente. P2:
// identificación, acciones de la fila y paginación. P3 (clave, mensajes del SRI): en el detalle.
// - Vistas «Todas» y «Requiere atención» y un filtro de un estado, como los admite la API (D6).
// - Ni orden por columna ni filtro de ambiente: el servidor no los ofrece.
// - Sin acciones fiscales en la fila ni consultas por fila (D11).
"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  INVOICE_STATE_LABELS,
  INVOICE_STATES,
  type DraftSummaryView,
  type EntryState,
  type Environment,
  type InvoiceEntryView,
  type InvoiceSummaryView,
} from "@facturador/contracts";
import { Copy, Eye, FileText, Lock, Plus, SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableCard } from "@/components/data-table/data-table-card";
import {
  MoneyCell,
  MutedCell,
  PartyCell,
  RecordLink,
} from "@/components/data-table/data-table-cells";
import { DataTableSearch } from "@/components/data-table/data-table-search";
import {
  DataTableSelectFilter,
  type SelectFilterOption,
} from "@/components/data-table/data-table-select-filter";
import { DataTableEmpty, DataTableError } from "@/components/data-table/data-table-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RowActionsMenu, type RowAction } from "@/components/data-table/row-actions-menu";
import { toast } from "@/components/feedback";
import { useSession } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompanyStatus } from "@/features/company/company-api";
import {
  AttentionMarker,
  DOCUMENT_STATE_PRESENTATION,
  DraftStateBadge,
  StateCell,
  requiresAttention,
} from "@/features/documents/document-status-badge";
import {
  DRAFT_FILTER_LABEL,
  DRAFT_STATE_PARAM,
  DraftEditedAt,
  DraftParty,
  draftRowActions,
} from "@/features/documents/draft-entries";
import { useListUrlState } from "@/hooks/use-list-url-state";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { buyerLabel, formatIssueDate } from "./invoice-format";
import { useDeleteDraft, useInvoiceAttentionCount, useInvoiceEntries } from "./invoices-api";

type View = "todas" | "atencion";

/** Valor de `estado` en la URL de cada estado (D6); los de hoy se conservan. */
const STATE_PARAMS: Record<EntryState, string> = {
  DRAFT: DRAFT_STATE_PARAM,
  RESERVED: "procesando",
  SIGNED: "firmadas",
  SEND_UNKNOWN: "verificando",
  RECEIVED: "recibidas",
  RETURNED: "devueltas",
  AUTHORIZED: "autorizadas",
  NOT_AUTHORIZED: "no-autorizadas",
  MANUAL_REVIEW: "revision",
};
/** «Borradores» primero, justo después de «Todos»; después los estados del glosario. */
const STATE_OPTIONS: readonly SelectFilterOption<EntryState>[] = [
  { value: "DRAFT", label: DRAFT_FILTER_LABEL },
  ...INVOICE_STATES.map((state) => ({
    value: state,
    label: INVOICE_STATE_LABELS[state],
    icon: DOCUMENT_STATE_PRESENTATION[state].icon,
  })),
];
const stateFromParam = (param: string): EntryState | undefined =>
  (Object.keys(STATE_PARAMS) as EntryState[]).find((state) => STATE_PARAMS[state] === param);

/** Los enlaces anteriores abrían «Requiere atención» con `estado=atencion`. */
function normalizeLegacyParams(params: URLSearchParams): boolean {
  if (params.get("estado") !== "atencion") return false;
  params.delete("estado");
  params.set("vista", "atencion");
  return true;
}

const SEARCH_LABEL = "Buscar por número, comprador o identificación";
const SEARCH_MAX_LENGTH = 100;

/**
 * Ambiente de una factura distinto del vigente (D13, PO-4; tarea 11.1). Si el vigente no se puede
 * confirmar no hay ambiente con el que coincidir: se indica el de cada fila, para que el silencio
 * nunca sugiera que una factura es del ambiente vigente. Solo se usa el `environment` real de la
 * fila. Es contexto: ni éxito ni rechazo, y no se mezcla con el estado.
 */
function environmentMark(invoice: Environment, current: Environment | undefined) {
  if (invoice === current) return null;
  if (invoice === "TEST") {
    return (
      <>
        <Badge variant="neutral">Pruebas</Badge>
        <span>
          <span className="sr-only">, </span>
          sin validez tributaria
        </span>
      </>
    );
  }
  return <Badge variant="emphasis">Producción</Badge>;
}

async function copyNumber(documentNumber: string) {
  try {
    await navigator.clipboard.writeText(documentNumber);
    toast.success(`Copiaste el número ${documentNumber}.`, { id: "copiar-numero" });
  } catch {
    toast.error("No pudimos copiar el número. Selecciónalo y cópialo.", { id: "copiar-numero" });
  }
}

function invoiceActions(invoice: InvoiceSummaryView): RowAction[] {
  return [
    { key: "ver", label: "Ver factura", icon: Eye, href: `/facturas/${invoice.id}` },
    {
      key: "copiar",
      label: "Copiar número",
      icon: Copy,
      onSelect: () => void copyNumber(invoice.documentNumber),
    },
  ];
}

function InvoiceActions({ invoice }: { invoice: InvoiceSummaryView }) {
  return (
    <RowActionsMenu
      label={`Acciones de la factura ${invoice.documentNumber}`}
      actions={invoiceActions(invoice)}
    />
  );
}

function NewInvoiceLink({
  variant = "primary",
  size = "default",
}: {
  variant?: "primary" | "outline";
  size?: "default" | "sm";
}) {
  return (
    <Button asChild variant={variant} size={size}>
      <Link href="/borradores/nuevo">
        <Plus aria-hidden="true" data-icon="inline-start" />
        Nueva factura
      </Link>
    </Button>
  );
}

/** Lo que nombra el vacío por filtros: la vista, el estado y la búsqueda activos. */
function describeFilters(view: View, state: EntryState | undefined, search: string): string {
  const parts = [
    view === "atencion" ? "requiere atención" : null,
    state === "DRAFT"
      ? "es un borrador"
      : state
        ? `está en «${INVOICE_STATE_LABELS[state]}»`
        : null,
    search ? `coincide con «${search}»` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "Ninguna factura coincide con los filtros.";
  const last = parts.pop()!;
  return `Ninguna factura ${parts.length > 0 ? `${parts.join(", ")} y ${last}` : last}.`;
}

/** Lo que una fila sabe hacer con su borrador: abrirlo y pedir su eliminación. */
type DraftHandlers = { onDeleteDraft: ((draft: DraftSummaryView) => void) | undefined };

const draftHref = (draft: DraftSummaryView) => `/borradores/${draft.id}`;
const draftBuyer = (draft: DraftSummaryView) => (draft.buyer ? buyerLabel(draft.buyer) : null);

function EntryActions({ entry, handlers }: { entry: InvoiceEntryView; handlers: DraftHandlers }) {
  if (entry.kind === "DOCUMENT") return <InvoiceActions invoice={entry.document} />;
  const draft = entry.draft;
  return (
    <RowActionsMenu
      label={`Acciones del borrador de ${draftBuyer(draft) ?? "factura sin comprador"}`}
      actions={draftRowActions({
        editHref: draftHref(draft),
        onDelete: handlers.onDeleteDraft && (() => handlers.onDeleteDraft?.(draft)),
      })}
    />
  );
}

function useInvoiceColumns(currentEnvironment: Environment | undefined, handlers: DraftHandlers) {
  return useMemo<ColumnDef<InvoiceEntryView, unknown>[]>(
    () => [
      {
        id: "invoice",
        header: "Factura",
        // El margen izquierdo aloja la marca de atención: los números quedan alineados.
        meta: {
          headClassName: "pl-4 @table-wide:pl-5",
          skeletonClassName: "w-36",
          cellClassName:
            "w-full py-2 pr-2 pl-4 @table-wide:w-auto @table-wide:pr-3 @table-wide:pl-5",
        },
        cell: ({ row }) => {
          const entry = row.original;
          if (entry.kind === "DRAFT") {
            const draft = entry.draft;
            return (
              <div className="flex flex-col gap-1">
                <RecordLink href={draftHref(draft)} className="whitespace-nowrap">
                  Borrador
                </RecordLink>
                <span className="text-xs">
                  <DraftEditedAt updatedAt={draft.updatedAt} />
                </span>
                <span className="line-clamp-2 text-sm break-words @table-wide:hidden">
                  <DraftParty name={draftBuyer(draft)} missing="Sin comprador" />
                </span>
                <span className="@table-wide:hidden">
                  <DraftStateBadge />
                </span>
              </div>
            );
          }
          const invoice = entry.document;
          const mark = environmentMark(invoice.environment, currentEnvironment);
          return (
            <div className="flex flex-col gap-1">
              <span className="relative flex items-center">
                {requiresAttention(invoice) && <AttentionMarker className="absolute -left-3" />}
                <RecordLink href={`/facturas/${invoice.id}`} className="whitespace-nowrap">
                  {invoice.documentNumber}
                </RecordLink>
              </span>
              <span
                className={cn(
                  "flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground",
                  mark ? "flex" : "hidden @table-wide:flex",
                )}
              >
                <span className="hidden tabular-nums @table-wide:inline">
                  {formatIssueDate(invoice.issueDate)}
                </span>
                {mark}
              </span>
              <span className="line-clamp-2 text-sm font-medium break-words @table-wide:hidden">
                {invoice.buyerName}
              </span>
              <span className="@table-wide:hidden">
                <StateCell state={invoice.state} stopped={invoice.transmissionStopped} />
              </span>
            </div>
          );
        },
      },
      {
        id: "state",
        header: "Estado",
        meta: {
          headClassName: "hidden @table-wide:table-cell",
          cellClassName: "hidden @table-wide:table-cell",
          skeletonClassName: "w-36",
        },
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
        id: "buyer",
        header: "Comprador",
        meta: {
          headClassName: "hidden @table-wide:table-cell",
          cellClassName: "hidden @table-wide:table-cell @table-wide:w-full @table-wide:max-w-0",
          skeletonClassName: "w-full max-w-56",
        },
        cell: ({ row }) => {
          const entry = row.original;
          if (entry.kind === "DRAFT") {
            const buyer = entry.draft.buyer;
            return buyer ? (
              <PartyCell name={buyer.legalName} identification={buyer.identification} truncate />
            ) : (
              <MutedCell>Sin comprador</MutedCell>
            );
          }
          return (
            <PartyCell
              name={entry.document.buyerName}
              identification={entry.document.buyerIdentification}
              truncate
            />
          );
        },
      },
      {
        id: "total",
        header: "Total",
        // En la compacta, el menú va en esta celda: el encabezado se alinea con el importe.
        meta: {
          headClassName: "pr-10.5 text-right @table-wide:pr-3",
          cellClassName: "py-2 pr-2 pl-2 text-right @table-wide:pr-3 @table-wide:pl-3",
          skeletonClassName: "ml-auto w-24",
        },
        cell: ({ row }) => {
          const entry = row.original;
          const amount = entry.kind === "DRAFT" ? entry.draft.previewTotal : entry.document.total;
          return (
            <span className="flex items-start justify-end gap-0.5">
              <span className="flex flex-col items-end gap-1">
                {amount === null ? (
                  <MutedCell>Incompleto</MutedCell>
                ) : (
                  <MoneyCell amount={amount} />
                )}
                <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums @table-wide:hidden">
                  {entry.kind === "DOCUMENT" && formatIssueDate(entry.document.issueDate)}
                </span>
              </span>
              <span className="-my-1 @table-wide:hidden">
                <EntryActions entry={entry} handlers={handlers} />
              </span>
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "Acciones",
        meta: {
          srOnlyHeader: true,
          headClassName: "hidden w-12 @table-wide:table-cell",
          cellClassName: "hidden w-12 text-right @table-wide:table-cell",
          skeletonClassName: "ml-auto size-6",
        },
        cell: ({ row }) => <EntryActions entry={row.original} handlers={handlers} />,
      },
    ],
    [currentEnvironment, handlers],
  );
}

export function InvoicesScreen() {
  const { me } = useSession();
  const router = useRouter();
  const allowed = canSee(me.role, "invoices.read");
  const canDraft = canSee(me.role, "invoices.draft");
  const url = useListUrlState({ normalize: normalizeLegacyParams });
  // `estado=atencion` ya se lee como la vista mientras la URL se reescribe: sin una consulta de más.
  const view: View =
    url.get("vista") === "atencion" || url.get("estado") === "atencion" ? "atencion" : "todas";
  const state = stateFromParam(url.get("estado"));
  const search = url.get("q").trim().slice(0, SEARCH_MAX_LENGTH);

  const invoices = useInvoiceEntries(
    { search, state, attention: view === "atencion", page: url.page, pageSize: url.pageSize },
    allowed,
  );
  const attentionCount = useInvoiceAttentionCount(allowed);
  const company = useCompanyStatus();
  const [deleting, setDeleting] = useState<DraftSummaryView | null>(null);
  const deleteDraft = useDeleteDraft({ onSuccess: () => setDeleting(null) });
  const handlers = useMemo<DraftHandlers>(
    () => ({ onDeleteDraft: canDraft ? setDeleting : undefined }),
    [canDraft],
  );
  const columns = useInvoiceColumns(company.data?.environment, handlers);

  const { clampPage } = url;
  const total = invoices.data && !invoices.isPlaceholderData ? invoices.data.meta.total : null;
  useEffect(() => {
    if (total !== null) clampPage(total);
  }, [clampPage, total]);

  // Una página posterior a la última llega vacía con total: se espera a la última sin mostrar vacío.
  const settlingPage =
    invoices.data !== undefined &&
    invoices.data.data.length === 0 &&
    invoices.data.meta.total > 0 &&
    !invoices.isError;
  const forbidden = invoices.error instanceof ApiError && invoices.error.status === 403;
  const card = {
    title: "Facturas",
    titleId: "facturas-titulo",
    description: "Las facturas que emites y su estado ante el SRI.",
  };

  if (!allowed || forbidden) {
    return (
      <DataTableCard {...card}>
        <DataTableEmpty
          icon={Lock}
          title="No tienes acceso a Facturas"
          description="Pide a un administrador que revise tu rol."
        />
      </DataTableCard>
    );
  }

  const clearFilters = () => url.update({ vista: null, estado: null, q: null });
  // La vista cuenta para el vacío por filtros; «Limpiar filtros» aparece solo con un estado o una
  // búsqueda, porque «Todas» ya deshace la vista. Cada filtro activo se ve en su control y se quita
  // desde él: el estado eligiendo «Todos» y la búsqueda con su botón.
  const filtersActive = view !== "todas" || state !== undefined || search !== "";
  const clearable = state !== undefined || search !== "";

  const tableState = invoices.isError ? (
    <DataTableError
      message="No pudimos cargar las facturas."
      onRetry={() => void invoices.refetch()}
    />
  ) : invoices.data && invoices.data.meta.total === 0 ? (
    filtersActive ? (
      <DataTableEmpty
        icon={SearchX}
        title="No hay facturas con estos filtros"
        description={describeFilters(view, state, search)}
        action={
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        }
      />
    ) : (
      <DataTableEmpty
        icon={FileText}
        title="Todavía no hay facturas"
        description="Aquí aparecen las facturas que emites. Empieza con un borrador."
        action={canDraft ? <NewInvoiceLink variant="outline" /> : undefined}
      />
    )
  ) : undefined;

  return (
    <DataTableCard
      {...card}
      search={
        <DataTableSearch
          label={SEARCH_LABEL}
          placeholder="Número, comprador o identificación"
          value={search}
          onChange={(next) => url.update({ q: next })}
          maxLength={SEARCH_MAX_LENGTH}
        />
      }
      actions={canDraft ? <NewInvoiceLink size="sm" /> : undefined}
      filters={
        <>
          <DataTableSelectFilter<View>
            label="Vista"
            value={view}
            options={[
              { value: "todas", label: "Todas" },
              {
                value: "atencion",
                label: "Requiere atención",
                ...(attentionCount.data !== undefined ? { count: attentionCount.data } : {}),
              },
            ]}
            onChange={(next) => url.update({ vista: next === "atencion" ? next : null })}
          />
          <DataTableSelectFilter<EntryState>
            label="Estado"
            value={state}
            allLabel="Todos"
            options={STATE_OPTIONS}
            onChange={(next) => url.update({ estado: next ? STATE_PARAMS[next] : null })}
          />
        </>
      }
      filtersEnd={
        clearable ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        ) : undefined
      }
    >
      <DataTable
        label="Facturas y borradores"
        columns={columns}
        data={invoices.data?.data ?? []}
        getRowId={(entry) =>
          entry.kind === "DRAFT" ? `borrador-${entry.draft.id}` : entry.document.id
        }
        rowCount={invoices.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={url.setPage}
        onPageSizeChange={url.setPageSize}
        loading={invoices.isPending || settlingPage}
        refreshing={invoices.isFetching}
        state={tableState}
        onRowOpen={(entry) =>
          router.push(
            entry.kind === "DRAFT" ? draftHref(entry.draft) : `/facturas/${entry.document.id}`,
          )
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Eliminar borrador"
        description={
          deleting
            ? `Eliminarás el borrador de ${draftBuyer(deleting) ?? "factura sin comprador"}. No se puede recuperar; no tiene número ni datos fiscales.`
            : ""
        }
        confirmLabel="Eliminar borrador"
        tone="danger"
        pending={deleteDraft.isPending}
        onConfirm={() => {
          if (deleting) deleteDraft.mutate(deleting.id);
        }}
      />
    </DataTableCard>
  );
}

/** Geometría de la pantalla mientras se leen los parámetros de la URL. */
export function InvoicesSkeleton() {
  return (
    <DataTableCard
      busy
      title="Facturas"
      titleId="facturas-titulo"
      description="Las facturas que emites y su estado ante el SRI."
    >
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </DataTableCard>
  );
}

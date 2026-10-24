// Comprobantes, la bandeja documental (add-document-archive, design D13). Usuario: administrador u
// operador, a diario. Objetivo: encontrar un comprobante emitido para descargarlo, imprimirlo o
// revisar su estado. Decisión: qué comprobante abrir o qué documento entregar. Información mínima:
// número, fecha, receptor, total, estado y si el RIDE está disponible. Acción principal: abrir el
// comprobante. P0: número, estado y RIDE; P1: fecha, receptor y total; P2: filtros avanzados
// (fechas, identificación, establecimiento, punto y tipo); P3 (identificadores y hashes): no se
// muestra. La factura, la liquidación de compra, la nota de crédito, la nota de débito, la guía de
// remisión y el comprobante de retención conviven con su tipo bajo el número (add-credit-notes,
// design D15; add-debit-notes, design D19; add-shipping-guides, design D21; add-withholding-receipts,
// design D20; add-purchase-settlements, design D20); en la retención, el total es el retenido y el
// receptor el sujeto retenido; la guía no tiene total y su receptor es su único destinatario o "N
// destinatarios"; en la liquidación, la contraparte es su proveedor y se rotula "Proveedor". Junto al
// estado, el indicador del último correo y el filtro «Correo» con «No enviado» (add-email-delivery,
// design D14). La búsqueda encuentra por número, receptor o identificación, y las fechas van a su
// izquierda, de su mismo tamaño; los desplegables se reparten su fila (refine-archive-search). La
// cabecera va en dos columnas, 25 % y 75 %, con los tres campos en una sola fila (2026-10-24).
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  DOCUMENT_TYPE_LABELS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type DocumentListItem,
  type DocumentState,
} from "@facturador/contracts";
import { Download, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DataTableCard } from "@/components/data-table/data-table-card";
import { DataTableSelectFilter } from "@/components/data-table/data-table-select-filter";
import { RowActionButton, SearchInput } from "@/components/data-table/table-controls";
import { DatePickerField } from "@/components/date-picker-field";
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
import { pointLabel, useEstablishments } from "@/features/establishments/establishments-api";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import { StateCell } from "@/features/documents/document-status-badge";
import { EmailIndicator } from "@/features/email/email-indicator";
import { useDocuments, useDownloadDocument } from "./archive-api";
import { RIDE_STATUS_LABELS, receiverOf } from "./archive-format";
import { EMITTED_DOCUMENT_TYPES, documentKind } from "./document-kinds";

type StateFilter =
  | "todos"
  | "autorizados"
  | "pendientes-autorizacion"
  | "pendientes-envio"
  | "verificando"
  | "revision"
  | "devueltos"
  | "no-autorizados"
  | "procesando";
const STATE_FILTERS: readonly { value: StateFilter; label: string; state?: DocumentState }[] = [
  { value: "todos", label: "Todos" },
  { value: "autorizados", label: "Autorizados", state: "AUTHORIZED" },
  { value: "pendientes-autorizacion", label: "Pendientes de autorización", state: "RECEIVED" },
  { value: "pendientes-envio", label: "Pendientes de envío", state: "SIGNED" },
  { value: "verificando", label: "Verificando con el SRI", state: "SEND_UNKNOWN" },
  { value: "revision", label: "Requieren revisión", state: "MANUAL_REVIEW" },
  { value: "devueltos", label: "Devueltos", state: "RETURNED" },
  { value: "no-autorizados", label: "No autorizados", state: "NOT_AUTHORIZED" },
  { value: "procesando", label: "Procesando", state: "RESERVED" },
];
const isStateFilter = (value: string | null): value is StateFilter =>
  STATE_FILTERS.some((filter) => filter.value === value);
/** Tipos que la bandeja ofrece en su filtro: los que el sistema emite. */
const TYPE_FILTERS = [
  { value: "", label: "Todos" },
  ...EMITTED_DOCUMENT_TYPES.map((type) => ({ value: type, label: DOCUMENT_TYPE_LABELS[type] })),
] as const;
const isTypeFilter = (value: string | null): value is (typeof EMITTED_DOCUMENT_TYPES)[number] =>
  EMITTED_DOCUMENT_TYPES.some((type) => type === value);
/** «No enviado» en la URL: el último envío por correo falló (`emailStatus=FAILED` en la API). */
const EMAIL_NOT_SENT = "no-enviado";
const detailPath = (item: DocumentListItem) => documentKind(item.documentType)?.detailPath;
/** "Proveedor" cuando la contraparte no es un comprador (la liquidación de compra). */
const counterpartyLabel = (item: DocumentListItem) =>
  documentKind(item.documentType)?.counterpartyLabel ?? null;

const CARD = {
  title: "Archivo de comprobantes",
  titleId: "comprobantes-titulo",
  description: "Todos los comprobantes que emites, con su estado ante el SRI y su RIDE.",
};
function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const stateParam = params.get("estado");
  const filter: StateFilter = isStateFilter(stateParam) ? stateParam : "todos";
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get("filas") ?? "", 10);
  const pageSize = sizeParam >= 1 && sizeParam <= PAGE_SIZE_MAX ? sizeParam : PAGE_SIZE_DEFAULT;
  const value = (key: string) => params.get(key) ?? "";
  const typeParam = params.get("tipo");
  const emailParam = params.get("correo");
  // La última consulta pedida: dos cambios seguidos (Desde y luego Hasta) se acumulan aunque el
  // primero todavía no haya llegado a la URL.
  const current = params.toString();
  const requested = useRef<string | null>(null);
  useEffect(() => {
    if (requested.current === current) requested.current = null;
  }, [current]);
  function update(changes: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(requested.current ?? current);
    for (const [key, change] of Object.entries(changes)) {
      if (change === null || change === "") next.delete(key);
      else next.set(key, change);
    }
    if (resetPage) next.delete("pagina");
    const query = next.toString();
    requested.current = query;
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  return {
    filter,
    page,
    pageSize,
    search: value("q"),
    documentType: isTypeFilter(typeParam) ? typeParam : undefined,
    from: value("desde"),
    to: value("hasta"),
    establishmentId: value("establecimiento"),
    emissionPointId: value("punto"),
    // Un valor desconocido en la URL no filtra.
    emailFilter: emailParam === EMAIL_NOT_SENT ? EMAIL_NOT_SENT : undefined,
    update,
  };
}

/** Descarga del RIDE disponible desde la fila, con su estado de envío. */
function RideCell({ document: item }: { document: DocumentListItem }) {
  const download = useDownloadDocument();
  const { me } = useSession();
  if (item.documents.ride === "AVAILABLE" && canSee(me.role, "archive.download")) {
    return (
      <RowActionButton
        icon={Download}
        label={`Descargar el RIDE de ${item.number}`}
        disabled={download.isPending}
        onClick={() => download.mutate({ id: item.id, kind: "ride" })}
      />
    );
  }
  const label = RIDE_STATUS_LABELS[item.documents.ride];
  return label ? <span className="text-sm text-foreground-muted">{label}</span> : null;
}

export function DocumentsScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "archive.read");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibility] = useState<VisibilityState>({});
  const establishments = useEstablishments(allowed && canSee(me.role, "establishments.read"));

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  // Un rango invertido se explica en el campo y no se consulta.
  const rangeError =
    url.from && url.to && url.from > url.to
      ? "La fecha final no puede ser anterior a la inicial."
      : null;
  const state = STATE_FILTERS.find((filter) => filter.value === url.filter)?.state;
  const documents = useDocuments(
    {
      search: url.search,
      documentType: url.documentType,
      state,
      from: url.from,
      to: url.to,
      identification: "",
      establishmentId: url.establishmentId,
      emissionPointId: url.emissionPointId,
      emailStatus: url.emailFilter ? "FAILED" : undefined,
      page: url.page,
      pageSize: url.pageSize,
    },
    allowed && rangeError === null,
  );
  const forbidden = documents.error instanceof ApiError && documents.error.status === 403;
  const filtersActive =
    url.search !== "" ||
    url.documentType !== undefined ||
    url.filter !== "todos" ||
    url.from !== "" ||
    url.to !== "" ||
    url.establishmentId !== "" ||
    url.emissionPointId !== "" ||
    url.emailFilter !== undefined;
  const establishmentOptions = establishments.data ?? [];
  const selectedEstablishment = establishmentOptions.find(
    (establishment) => establishment.id === url.establishmentId,
  );

  const columns = useMemo<ColumnDef<DocumentListItem, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Número",
        cell: ({ row }) => {
          const base = detailPath(row.original);
          const label = (
            <span className="flex flex-col">
              <span className="font-semibold tabular-nums">{row.original.number}</span>
              <span className="text-xs text-foreground-muted">
                {DOCUMENT_TYPE_LABELS[row.original.documentType]}
              </span>
            </span>
          );
          return base ? (
            <Link
              href={`${base}/${row.original.id}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              {label}
            </Link>
          ) : (
            label
          );
        },
      },
      {
        id: "date",
        header: "Fecha",
        cell: ({ row }) => <MutedCell>{formatIssueDate(row.original.issueDate)}</MutedCell>,
      },
      {
        id: "buyer",
        header: "Receptor",
        cell: ({ row }) => {
          const receiver = receiverOf(row.original);
          const role = counterpartyLabel(row.original);
          return (
            <PartyCell
              name={receiver.name}
              identification={
                receiver.identification || role
                  ? [role, receiver.identification].filter(Boolean).join(" · ")
                  : undefined
              }
            />
          );
        },
      },
      {
        id: "total",
        header: () => <span className="block text-right">Total</span>,
        cell: ({ row }) =>
          row.original.total === null ? (
            // La guía de remisión no tiene total monetario (P10): nunca 0.00.
            <span className="block text-right text-foreground-muted">
              <span aria-hidden="true">—</span>
              <span className="sr-only">Sin total monetario</span>
            </span>
          ) : (
            <MoneyCell amount={row.original.total} className="block text-right" />
          ),
      },
      {
        id: "state",
        header: "Estado",
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <StateCell state={row.original.state} stopped={row.original.transmissionStopped} />
            <EmailIndicator status={row.original.email?.status ?? null} />
          </span>
        ),
      },
      {
        id: "ride",
        header: "RIDE",
        cell: ({ row }) => <RideCell document={row.original} />,
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
            title="No tienes acceso al Archivo de comprobantes"
            description="Pide a un administrador que revise tu rol."
          />
        </div>
      </DataTableCard>
    );
  }

  const clearFilters = () => {
    setSearchDraft("");
    url.update({
      q: null,
      tipo: null,
      estado: null,
      desde: null,
      hasta: null,
      establecimiento: null,
      punto: null,
      correo: null,
    });
  };

  const tableState = rangeError ? (
    <EmptyState
      kind="no-matches"
      title="Revisa el rango de fechas"
      description="La fecha final no puede ser anterior a la inicial."
    />
  ) : documents.isError ? (
    <ErrorState
      message="No pudimos cargar los comprobantes."
      onRetry={() => void documents.refetch()}
    />
  ) : documents.data && documents.data.data.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay comprobantes que coincidan"
        description="Prueba con otro número, receptor o rango de fechas, o quita los filtros."
        action={
          <Button variant="outline" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        }
      />
    ) : (
      <EmptyState
        kind="empty"
        title="Todavía no hay comprobantes"
        description="Los comprobantes aparecen aquí cuando emites una factura, una nota de crédito o una nota de débito."
      />
    )
  ) : undefined;

  // En un teléfono, los filtros salvo el estado se pliegan tras «Filtros»; desde 768 px, a la vista.
  // Desde 768 px, los desplegables comparten la fila del estado (`md:contents`) y las fechas van debajo.
  const folded = filtersOpen ? "flex" : "hidden";
  const filters = (
    <>
      <DataTableSelectFilter
        label="Estado"
        grow
        value={url.filter}
        options={STATE_FILTERS}
        onChange={(value) => url.update({ estado: value === "todos" ? null : value })}
      />
      <Button
        variant="outline"
        size="sm"
        className="max-md:w-full md:hidden"
        aria-expanded={filtersOpen}
        aria-controls="filtros-avanzados"
        onClick={() => setFiltersOpen((open) => !open)}
      >
        <SlidersHorizontal aria-hidden="true" />
        Filtros
      </Button>
      <div id="filtros-avanzados" className={`${folded} w-full flex-col gap-3 md:contents`}>
        <div className="flex flex-col gap-3 md:contents">
          <DataTableSelectFilter
            label="Tipo"
            grow
            value={url.documentType}
            allLabel="Todos"
            options={TYPE_FILTERS.filter((filter) => filter.value !== "").map((filter) => ({
              value: filter.value,
              label: filter.label,
            }))}
            onChange={(next) => url.update({ tipo: next ?? null })}
          />
          <DataTableSelectFilter
            label="Correo"
            grow
            value={url.emailFilter}
            allLabel="Todos"
            options={[{ value: EMAIL_NOT_SENT, label: "No enviado" }]}
            onChange={(next) => url.update({ correo: next ?? null })}
          />
          <DataTableSelectFilter
            label="Establecimiento"
            grow
            value={url.establishmentId || undefined}
            allLabel="Todos"
            options={establishmentOptions.map((establishment) => ({
              value: establishment.id,
              label: `${establishment.code} · ${establishment.address}`,
            }))}
            onChange={(next) => url.update({ establecimiento: next ?? null, punto: null })}
          />
          <DataTableSelectFilter
            label="Punto de emisión"
            grow
            value={url.emissionPointId || undefined}
            allLabel="Todos"
            disabled={!selectedEstablishment}
            options={
              selectedEstablishment?.emissionPoints.map((point) => ({
                value: point.id,
                label: pointLabel(selectedEstablishment, point),
              })) ?? []
            }
            onChange={(next) => url.update({ punto: next ?? null })}
          />
        </div>
      </div>
    </>
  );

  return (
    <DataTableCard
      {...CARD}
      search={
        <>
          <DatePickerField
            compact
            label="Desde"
            value={url.from}
            max={url.to || undefined}
            onChange={(value) => url.update({ desde: value })}
            className="w-[calc(50%-0.25rem)] md:w-auto md:min-w-0 md:flex-1"
          />
          <DatePickerField
            compact
            label="Hasta"
            value={url.to}
            min={url.from || undefined}
            error={rangeError}
            onChange={(value) => url.update({ hasta: value })}
            className="w-[calc(50%-0.25rem)] md:w-auto md:min-w-0 md:flex-1"
          />
          <SearchInput
            value={searchDraft}
            onChange={setSearchDraft}
            label="Buscar por número, receptor o identificación"
            placeholder="Número, receptor o identificación"
            className="sm:w-full md:min-w-0 md:flex-1"
          />
        </>
      }
      headerSplit
      filters={filters}
      filtersFill
    >
      <AppDataTable
        label="Comprobantes emitidos"
        columns={columns}
        data={rangeError ? [] : (documents.data?.data ?? [])}
        getRowId={(item) => item.id}
        total={rangeError ? 0 : (documents.data?.meta.total ?? 0)}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={!rangeError && documents.isPending}
        refreshing={documents.isFetching}
        state={tableState}
        renderCard={(item) => {
          const base = detailPath(item);
          return (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-col">
                  {base ? (
                    <RecordLink href={`${base}/${item.id}`}>{item.number}</RecordLink>
                  ) : (
                    <span className="font-semibold tabular-nums">{item.number}</span>
                  )}
                  <span className="text-xs text-foreground-muted">
                    {DOCUMENT_TYPE_LABELS[item.documentType]}
                  </span>
                </span>
                <RideCell document={item} />
              </div>
              <span className="break-words">
                {counterpartyLabel(item) ? (
                  <span className="text-foreground-muted">{counterpartyLabel(item)}: </span>
                ) : null}
                <span className="font-medium">{receiverOf(item).name}</span>
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="tabular-nums text-foreground-muted">
                  {formatIssueDate(item.issueDate)}
                </span>
                {item.total === null ? null : <MoneyCell amount={item.total} />}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <StateCell state={item.state} stopped={item.transmissionStopped} />
                <EmailIndicator status={item.email?.status ?? null} withLabel />
              </span>
            </div>
          );
        }}
      />
    </DataTableCard>
  );
}

export function DocumentsSkeleton() {
  return (
    <DataTableCard {...CARD} busy>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-60 w-full" />
      </div>
    </DataTableCard>
  );
}

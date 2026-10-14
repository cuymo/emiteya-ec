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
// destinatarios"; en la liquidación, la contraparte es su proveedor y se rotula "Proveedor".
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
import { ChipGroup, RowActionButton, SearchInput } from "@/components/data-table/table-controls";
import { DatePickerField } from "@/components/date-picker-field";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { pointLabel, useEstablishments } from "@/features/establishments/establishments-api";
import { formatIssueDate } from "@/features/invoices/invoice-format";
import { StateCell } from "@/features/invoices/invoices-screen";
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
const detailPath = (item: DocumentListItem) => documentKind(item.documentType)?.detailPath;
/** "Proveedor" cuando la contraparte no es un comprador (la liquidación de compra). */
const counterpartyLabel = (item: DocumentListItem) =>
  documentKind(item.documentType)?.counterpartyLabel ?? null;

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
    identification: value("identificacion"),
    establishmentId: value("establecimiento"),
    emissionPointId: value("punto"),
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
  const [identificationDraft, setIdentificationDraft] = useState(url.identification);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibility] = useState<VisibilityState>({});
  const establishments = useEstablishments(allowed && canSee(me.role, "establishments.read"));

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);
  useEffect(() => {
    if (identificationDraft.trim() === url.identification) return;
    const timer = setTimeout(() => url.update({ identificacion: identificationDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [identificationDraft, url]);

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
      identification: url.identification,
      establishmentId: url.establishmentId,
      emissionPointId: url.emissionPointId,
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
    url.identification !== "" ||
    url.establishmentId !== "" ||
    url.emissionPointId !== "";
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
              <span className="font-medium tabular-nums">{row.original.number}</span>
              <span className="text-xs text-foreground-muted">
                {DOCUMENT_TYPE_LABELS[row.original.documentType]}
              </span>
            </span>
          );
          return base ? (
            <Link
              href={`${base}/${row.original.id}`}
              className="underline-offset-2 hover:underline"
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
        cell: ({ row }) => (
          <span className="tabular-nums">{formatIssueDate(row.original.issueDate)}</span>
        ),
      },
      {
        id: "buyer",
        header: "Receptor",
        cell: ({ row }) => {
          const receiver = receiverOf(row.original);
          const role = counterpartyLabel(row.original);
          return (
            <span className="flex flex-col">
              <span className="break-words">{receiver.name}</span>
              {receiver.identification || role ? (
                <span className="text-xs text-foreground-muted tabular-nums">
                  {[role, receiver.identification].filter(Boolean).join(" · ")}
                </span>
              ) : null}
            </span>
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
      <section aria-labelledby="comprobantes-titulo" className="flex flex-col gap-6">
        <h1 id="comprobantes-titulo" className="text-3xl font-bold">
          Archivo de comprobantes
        </h1>
        <EmptyState
          kind="no-permission"
          title="No tienes acceso al Archivo de comprobantes"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }

  const clearFilters = () => {
    setSearchDraft("");
    setIdentificationDraft("");
    url.update({
      q: null,
      tipo: null,
      estado: null,
      desde: null,
      hasta: null,
      identificacion: null,
      establecimiento: null,
      punto: null,
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

  const advancedFilters = (
    <div
      id="filtros-avanzados"
      className={`${filtersOpen ? "grid" : "hidden"} grid-cols-1 gap-2 sm:grid-cols-2 md:grid md:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))]`}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-tipo">Tipo de comprobante</Label>
        <Select
          id="filtro-tipo"
          value={url.documentType ?? ""}
          onChange={(event) => url.update({ tipo: event.target.value })}
        >
          {TYPE_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </Select>
      </div>
      <DatePickerField
        label="Desde"
        value={url.from}
        max={url.to || undefined}
        onChange={(value) => url.update({ desde: value })}
      />
      <DatePickerField
        label="Hasta"
        value={url.to}
        min={url.from || undefined}
        error={rangeError}
        onChange={(value) => url.update({ hasta: value })}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-identificacion">Identificación del receptor</Label>
        <Input
          id="filtro-identificacion"
          inputMode="numeric"
          value={identificationDraft}
          onChange={(event) => setIdentificationDraft(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-establecimiento">Establecimiento</Label>
        <Select
          id="filtro-establecimiento"
          value={url.establishmentId}
          onChange={(event) => url.update({ establecimiento: event.target.value, punto: null })}
        >
          <option value="">Todos</option>
          {establishmentOptions.map((establishment) => (
            <option key={establishment.id} value={establishment.id}>
              {establishment.code} · {establishment.address}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="filtro-punto">Punto de emisión</Label>
        <Select
          id="filtro-punto"
          value={url.emissionPointId}
          disabled={!selectedEstablishment}
          onChange={(event) => url.update({ punto: event.target.value })}
        >
          <option value="">Todos</option>
          {selectedEstablishment?.emissionPoints.map((point) => (
            <option key={point.id} value={point.id}>
              {pointLabel(selectedEstablishment, point)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );

  return (
    <section aria-labelledby="comprobantes-titulo" className="flex flex-col gap-6">
      <h1 id="comprobantes-titulo" className="text-3xl font-bold">
        Archivo de comprobantes
      </h1>
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
        toolbar={
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <SearchInput
                value={searchDraft}
                onChange={setSearchDraft}
                label="Buscar por número o receptor"
                placeholder="Número o receptor"
              />
              <Button
                variant="outline"
                className="md:hidden"
                aria-expanded={filtersOpen}
                aria-controls="filtros-avanzados"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <SlidersHorizontal aria-hidden="true" />
                Filtros
              </Button>
              <ChipGroup
                label="Estado"
                value={url.filter}
                options={STATE_FILTERS}
                onChange={(value) => url.update({ estado: value === "todos" ? null : value })}
              />
            </div>
            {advancedFilters}
          </div>
        }
        renderCard={(item) => {
          const base = detailPath(item);
          return (
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-col">
                  {base ? (
                    <Link
                      href={`${base}/${item.id}`}
                      className="font-medium tabular-nums underline-offset-2 hover:underline"
                    >
                      {item.number}
                    </Link>
                  ) : (
                    <span className="font-medium tabular-nums">{item.number}</span>
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
                {receiverOf(item).name}
              </span>
              <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="tabular-nums text-foreground-muted">
                  {formatIssueDate(item.issueDate)}
                </span>
                {item.total === null ? null : (
                  <span className="tabular-nums">{formatUsd(item.total)}</span>
                )}
              </span>
              <StateCell state={item.state} stopped={item.transmissionStopped} />
            </div>
          );
        }}
      />
    </section>
  );
}

export function DocumentsSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-60 w-full" />
    </section>
  );
}

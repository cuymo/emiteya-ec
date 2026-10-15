// Facturas (add-invoice-emission, design D15; add-sri-transmission, design D20). Usuario:
// administrador u operador, a diario. Objetivo: encontrar una factura y saber si quedó autorizada.
// Decisión: qué factura necesita atención. Información mínima: número, comprador, total, fecha y
// estado. Acción principal: abrir la factura. P1: búsqueda y estado; P2: fecha; P3 (clave,
// versiones): en el detalle o fuera.
"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  type InvoiceState,
  type InvoiceSummaryView,
} from "@facturador/contracts";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { ChipGroup, SearchInput } from "@/components/data-table/table-controls";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { StateCell } from "@/features/documents/document-status-badge";
import { formatIssueDate } from "./invoice-format";
import { useInvoices } from "./invoices-api";

type StateFilter =
  "todas" | "atencion" | "procesando" | "firmadas" | "autorizadas" | "devueltas" | "no-autorizadas";
const STATE_FILTERS: readonly { value: StateFilter; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "atencion", label: "Requiere atención" },
  { value: "procesando", label: "Procesando" },
  { value: "firmadas", label: "Pendientes de envío" },
  { value: "autorizadas", label: "Autorizadas" },
  { value: "devueltas", label: "Devueltas" },
  { value: "no-autorizadas", label: "No autorizadas" },
];
const FILTER_TO_STATE: Record<StateFilter, InvoiceState | undefined> = {
  todas: undefined,
  atencion: undefined,
  procesando: "RESERVED",
  firmadas: "SIGNED",
  autorizadas: "AUTHORIZED",
  devueltas: "RETURNED",
  "no-autorizadas": "NOT_AUTHORIZED",
};
const isStateFilter = (value: string | null): value is StateFilter =>
  STATE_FILTERS.some((filter) => filter.value === value);

function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const stateParam = params.get("estado");
  const filter: StateFilter = isStateFilter(stateParam) ? stateParam : "todas";
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get("filas") ?? "", 10);
  const pageSize = sizeParam >= 1 && sizeParam <= PAGE_SIZE_MAX ? sizeParam : PAGE_SIZE_DEFAULT;
  const search = params.get("q") ?? "";
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
  return { filter, page, pageSize, search, update };
}

export function InvoicesScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "invoices.read");
  const url = useUrlState();
  const [searchDraft, setSearchDraft] = useState(url.search);
  const [visibility] = useState<VisibilityState>({});

  useEffect(() => {
    if (searchDraft.trim() === url.search) return;
    const timer = setTimeout(() => url.update({ q: searchDraft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, url]);

  const invoices = useInvoices(
    {
      search: url.search,
      state: FILTER_TO_STATE[url.filter],
      attention: url.filter === "atencion",
      page: url.page,
      pageSize: url.pageSize,
    },
    allowed,
  );
  const forbidden = invoices.error instanceof ApiError && invoices.error.status === 403;
  const filtersActive = url.search !== "" || url.filter !== "todas";

  const columns = useMemo<ColumnDef<InvoiceSummaryView, unknown>[]>(
    () => [
      {
        id: "number",
        header: "Número",
        cell: ({ row }) => (
          <Link
            href={`/facturas/${row.original.id}`}
            className="font-medium tabular-nums underline-offset-2 hover:underline"
          >
            {row.original.documentNumber}
          </Link>
        ),
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
        header: () => <span className="block text-right">Total</span>,
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

  if (!allowed || forbidden) {
    return (
      <section aria-labelledby="facturas-titulo" className="flex flex-col gap-6">
        <h1 id="facturas-titulo" className="text-3xl font-bold">
          Facturas
        </h1>
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a Facturas"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }

  const tableState = invoices.isError ? (
    <ErrorState message="No pudimos cargar las facturas." onRetry={() => void invoices.refetch()} />
  ) : invoices.data && invoices.data.data.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay facturas que coincidan"
        description="Prueba con otro número o comprador, o quita el filtro."
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
        title="Todavía no hay facturas"
        description="Las facturas aparecen aquí cuando emites un borrador."
        action={
          <Button asChild variant="outline">
            <Link href="/borradores/nuevo">Nueva factura</Link>
          </Button>
        }
      />
    )
  ) : undefined;

  return (
    <section aria-labelledby="facturas-titulo" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 id="facturas-titulo" className="text-3xl font-bold">
          Facturas
        </h1>
      </div>
      <AppDataTable
        label="Facturas emitidas"
        columns={columns}
        data={invoices.data?.data ?? []}
        getRowId={(invoice) => invoice.id}
        total={invoices.data?.meta.total ?? 0}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={visibility}
        loading={invoices.isPending}
        refreshing={invoices.isFetching}
        state={tableState}
        toolbar={
          <div className="flex flex-wrap items-center gap-4">
            <SearchInput
              value={searchDraft}
              onChange={setSearchDraft}
              label="Buscar por número o comprador"
              placeholder="Número o comprador"
            />
            <ChipGroup
              label="Estado"
              value={url.filter}
              options={STATE_FILTERS}
              onChange={(value) => url.update({ estado: value === "todas" ? null : value })}
            />
          </div>
        }
        renderCard={(invoice) => (
          <div className="flex flex-col gap-2">
            <Link
              href={`/facturas/${invoice.id}`}
              className="font-medium tabular-nums underline-offset-2 hover:underline"
            >
              {invoice.documentNumber}
            </Link>
            <span className="text-sm break-words">{invoice.buyerName}</span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-foreground-muted tabular-nums">
              {formatUsd(invoice.total)} · {formatIssueDate(invoice.issueDate)}
              <StateCell state={invoice.state} stopped={invoice.transmissionStopped} />
            </span>
          </div>
        )}
      />
    </section>
  );
}

export function InvoicesSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold">Facturas</h1>
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-64 w-full" />
    </section>
  );
}

// Reportes (add-reports-export, design D16). Usuario: administrador u operador. Objetivo: revisar y
// entregar un listado de un período. Decisión: qué registros entregar y con qué filtros. Información
// mínima: el reporte, los filtros efectivos con el ambiente, el número de registros y las filas.
// Acción principal: "Exportar XLSX". P0: el reporte, los filtros, el número de registros y la
// exportación; P1: la tabla; P2: los filtros secundarios y el aviso de RF-505; P3 (identificadores
// internos): no se muestran. Sin dashboard, gráficos ni totales. Los filtros viven en la URL, y la
// exportación usa los mismos, con el ambiente efectivo de la lista.
"use client";

import {
  DOCUMENT_STATES,
  DOCUMENT_TYPE_LABELS,
  INVOICE_STATE_LABELS,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PARTY_ROLES,
  PARTY_ROLE_LABELS,
  REPORT_DEFAULT_STATES,
  REPORT_ENVIRONMENT_LABELS,
  REPORT_FISCAL_PERIOD_PATTERN,
  REPORT_LABELS,
  REPORT_NOTICE,
  STOCK_MOVEMENT_TYPES,
  STOCK_MOVEMENT_TYPE_LABELS,
  type ReportId,
  type ProductView,
} from "@facturador/contracts";
import { Download, Info, LoaderCircle, PackageSearch, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppDataTable } from "@/components/data-table/app-data-table";
import { DatePickerField } from "@/components/date-picker-field";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { SegmentedControl } from "@/components/segmented-control";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { canSee } from "@/lib/permissions";
import { useEstablishments, pointLabel } from "@/features/establishments/establishments-api";
import { fetchProducts } from "@/features/invoices/invoices-api";
import { EMITTED_DOCUMENT_TYPES } from "@/features/archive/document-kinds";
import { REPORT_PRESENTATIONS } from "./report-columns";
import { useExportReport, useReport, type ReportFilters } from "./reports-api";

/** Los cinco reportes del ERS; Inventario tiene dos vistas. */
const REPORT_OPTIONS = [
  { value: "documentos", label: "Documentos emitidos" },
  { value: "facturas", label: "Facturas" },
  { value: "retenciones", label: "Retenciones" },
  { value: "inventario", label: "Inventario" },
  { value: "terceros", label: "Terceros" },
] as const;
type ReportParam = (typeof REPORT_OPTIONS)[number]["value"];
const INVENTORY_VIEWS = [
  { value: "existencias", label: "Existencias" },
  { value: "movimientos", label: "Movimientos" },
] as const;
type InventoryView = (typeof INVENTORY_VIEWS)[number]["value"];

const ENVIRONMENT_PARAMS = { pruebas: "TEST", produccion: "PRODUCTION", todos: "ALL" } as const;
type EnvironmentParam = keyof typeof ENVIRONMENT_PARAMS;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function reportOf(param: ReportParam, view: InventoryView): ReportId {
  switch (param) {
    case "facturas":
      return "invoices";
    case "retenciones":
      return "withholdings";
    case "inventario":
      return view === "movimientos" ? "inventory-movements" : "inventory-balances";
    case "terceros":
      return "parties";
    default:
      return "issued-documents";
  }
}

const hasDates = (report: ReportId) =>
  report === "issued-documents" ||
  report === "invoices" ||
  report === "withholdings" ||
  report === "inventory-movements";
const hasEnvironment = (report: ReportId) =>
  report === "issued-documents" || report === "invoices" || report === "withholdings";
const hasState = (report: ReportId): report is keyof typeof REPORT_DEFAULT_STATES =>
  report in REPORT_DEFAULT_STATES;

/** Hoy en Ecuador, `AAAA-MM-DD`. */
const todayInEcuador = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(new Date());
const MONTH_LABEL = new Intl.DateTimeFormat("es-EC", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
/** El mes en curso y los once anteriores, `AAAA-MM`. */
function recentMonths(): string[] {
  const [year, month] = todayInEcuador().split("-").map(Number) as [number, number];
  return Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    return date.toISOString().slice(0, 7);
  });
}
const monthLabel = (month: string) => MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`));
/** Primer y último día del mes `AAAA-MM`. */
function monthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const reportParam = REPORT_OPTIONS.find(
    (option) => option.value === params.get("reporte"),
  )?.value;
  const view = INVENTORY_VIEWS.find((option) => option.value === params.get("vista"))?.value;
  const report = reportOf(reportParam ?? "documentos", view ?? "existencias");
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const sizeParam = Number.parseInt(params.get("filas") ?? "", 10);
  const pageSize = sizeParam >= 1 && sizeParam <= PAGE_SIZE_MAX ? sizeParam : PAGE_SIZE_DEFAULT;
  const value = (key: string) => params.get(key) ?? "";
  const date = (key: string) => (ISO_DATE.test(value(key)) ? value(key) : "");
  const environmentParam = value("ambiente");
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
    report,
    reportParam: reportParam ?? "documentos",
    view: view ?? "existencias",
    page,
    pageSize,
    from: date("desde"),
    to: date("hasta"),
    documentType: value("tipo"),
    state: value("estado"),
    establishmentId: value("establecimiento"),
    emissionPointId: value("punto"),
    environment:
      environmentParam in ENVIRONMENT_PARAMS ? (environmentParam as EnvironmentParam) : undefined,
    customer: value("cliente"),
    supplier: value("sujeto"),
    period: REPORT_FISCAL_PERIOD_PATTERN.test(value("periodo")) ? value("periodo") : "",
    productId: value("producto"),
    movementType: value("movimiento"),
    role: value("rol"),
    identification: value("identificacion"),
    update,
  };
}
type UrlState = ReturnType<typeof useUrlState>;

/** Los filtros del reporte elegido, con los nombres de la API; solo los suyos. */
function filtersOf(url: UrlState): ReportFilters {
  const dates = hasDates(url.report) ? { from: url.from, to: url.to } : {};
  const environment = url.environment ? ENVIRONMENT_PARAMS[url.environment] : undefined;
  switch (url.report) {
    case "issued-documents":
      return {
        ...dates,
        documentType: url.documentType,
        state: url.state,
        establishmentId: url.establishmentId,
        emissionPointId: url.emissionPointId,
        environment,
      };
    case "invoices":
      return { ...dates, customerIdentification: url.customer, state: url.state, environment };
    case "withholdings":
      return {
        ...dates,
        supplierIdentification: url.supplier,
        fiscalPeriod: url.period,
        state: url.state,
        environment,
      };
    case "inventory-balances":
      return { productId: url.productId };
    case "inventory-movements":
      return { ...dates, productId: url.productId, movementType: url.movementType };
    case "parties":
      return { role: url.role, identification: url.identification, status: url.state };
  }
}

const FILTER_KEYS = [
  "desde",
  "hasta",
  "tipo",
  "estado",
  "establecimiento",
  "punto",
  "ambiente",
  "cliente",
  "sujeto",
  "periodo",
  "producto",
  "movimiento",
  "rol",
  "identificacion",
] as const;
const cleared = Object.fromEntries(FILTER_KEYS.map((key) => [key, null])) as Record<string, null>;

/** Texto con espera: la URL cambia 300 ms después de dejar de escribir. */
function useDebouncedParam(url: UrlState, key: string, value: string) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => url.update({ [key]: draft.trim() }), 300);
    return () => clearTimeout(timer);
  }, [draft, value, key, url]);
  return [draft, setDraft] as const;
}

const EXPORT_MESSAGES: Record<string, string> = {
  REPORT_EXPORT_BUSY:
    "Hay otras exportaciones en curso en este momento. Intenta de nuevo en unos segundos.",
};

export function ReportsScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "reports.read");
  const canExport = canSee(me.role, "reports.export");
  const url = useUrlState();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedProduct, setPickedProduct] = useState<ProductView | null>(null);
  // El rechazo de una exportación se explica mientras no cambien el reporte ni sus filtros.
  const [exportProblem, setExportProblem] = useState<{ key: string; message: string } | null>(null);
  const establishments = useEstablishments(
    allowed && url.report === "issued-documents" && canSee(me.role, "establishments.read"),
  );
  const [customerDraft, setCustomerDraft] = useDebouncedParam(url, "cliente", url.customer);
  const [supplierDraft, setSupplierDraft] = useDebouncedParam(url, "sujeto", url.supplier);
  const [identificationDraft, setIdentificationDraft] = useDebouncedParam(
    url,
    "identificacion",
    url.identification,
  );

  const rangeError =
    hasDates(url.report) && url.from && url.to && url.from > url.to
      ? "La fecha final no puede ser anterior a la inicial."
      : null;
  const filters = filtersOf(url);
  const report = useReport(
    url.report,
    filters,
    { page: url.page, pageSize: url.pageSize },
    allowed && rangeError === null,
  );
  const forbidden = report.error instanceof ApiError && report.error.status === 403;
  const exportKey = useRef("");
  const exportReport = useExportReport({
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 409 || error.status === 503)) {
        setExportProblem({
          key: exportKey.current,
          message: EXPORT_MESSAGES[error.code] ?? error.message,
        });
        return true;
      }
      return false;
    },
  });
  const presentation = REPORT_PRESENTATIONS[url.report];
  const months = useMemo(() => recentMonths(), []);
  const selectedMonth = months.find((month) => {
    const range = monthRange(month);
    return range.from === url.from && range.to === url.to;
  });
  const effectiveEnvironment = report.data?.meta.environment ?? null;
  const filtersActive = Object.values(filters).some((value) => value !== undefined && value !== "");
  const establishmentOptions = establishments.data ?? [];
  const selectedEstablishment = establishmentOptions.find(
    (establishment) => establishment.id === url.establishmentId,
  );
  const rows = report.data?.data ?? [];
  const productName =
    pickedProduct?.id === url.productId
      ? pickedProduct.name
      : ((rows[0]?.productId === url.productId ? (rows[0]?.name as string) : null) ??
        "Producto elegido");

  const filterKey = `${url.report}?${JSON.stringify(filters)}`;

  if (!allowed || forbidden) {
    return (
      <section aria-labelledby="reportes-titulo" className="flex flex-col gap-3">
        <h1 id="reportes-titulo" className="text-3xl font-bold">
          Reportes
        </h1>
        <EmptyState
          kind="no-permission"
          title="No tienes acceso a Reportes"
          description="Pide a un administrador que revise tu rol."
        />
      </section>
    );
  }

  const clearFilters = () => {
    setCustomerDraft("");
    setSupplierDraft("");
    setIdentificationDraft("");
    url.update(cleared);
  };
  const chooseReport = (value: ReportParam) =>
    url.update({ ...cleared, reporte: value === "documentos" ? null : value, vista: null });

  const runExport = () => {
    setExportProblem(null);
    exportKey.current = filterKey;
    // El mismo ambiente que muestra la lista, aunque la empresa cambie de ambiente entre ambas.
    exportReport.mutate({
      report: url.report,
      filters:
        hasEnvironment(url.report) && effectiveEnvironment
          ? { ...filters, environment: effectiveEnvironment }
          : filters,
    });
  };

  const stateValue = hasState(url.report)
    ? url.state || REPORT_DEFAULT_STATES[url.report]
    : url.state || "ACTIVE";

  const dateFilters = hasDates(url.report) ? (
    <>
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="filtro-mes">Mes</Label>
        <Select
          id="filtro-mes"
          value={selectedMonth ?? ""}
          onChange={(event) => {
            const month = event.target.value;
            if (!month) return url.update({ desde: null, hasta: null });
            const range = monthRange(month);
            url.update({ desde: range.from, hasta: range.to });
          }}
        >
          <option value="">{url.from || url.to ? "Rango elegido" : "Todas las fechas"}</option>
          {months.map((month) => (
            <option key={month} value={month}>
              {monthLabel(month)}
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
    </>
  ) : null;

  const stateFilter = hasState(url.report) ? (
    <div className="flex flex-col gap-0.5">
      <Label htmlFor="filtro-estado">Estado</Label>
      <Select
        id="filtro-estado"
        value={stateValue}
        onChange={(event) => url.update({ estado: event.target.value })}
      >
        <option value="ALL">Todos</option>
        {DOCUMENT_STATES.map((state) => (
          <option key={state} value={state}>
            {INVOICE_STATE_LABELS[state]}
          </option>
        ))}
      </Select>
    </div>
  ) : null;

  const environmentFilter = hasEnvironment(url.report) ? (
    <div className="flex flex-col gap-0.5">
      <Label htmlFor="filtro-ambiente">Ambiente</Label>
      <Select
        id="filtro-ambiente"
        value={url.environment ?? ""}
        onChange={(event) => url.update({ ambiente: event.target.value })}
      >
        <option value="">Vigente de la empresa</option>
        <option value="pruebas">Pruebas</option>
        <option value="produccion">Producción</option>
        <option value="todos">Pruebas y Producción</option>
      </Select>
    </div>
  ) : null;

  const productFilter =
    url.report === "inventory-balances" || url.report === "inventory-movements" ? (
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium" id="filtro-producto">
          Producto
        </span>
        {url.productId ? (
          <span className="flex flex-wrap items-center gap-0.5">
            <span className="break-words">{productName}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => url.update({ producto: null })}
              aria-label="Quitar el filtro de producto"
            >
              <X aria-hidden="true" />
            </Button>
          </span>
        ) : (
          <Button
            variant="outline"
            aria-describedby="filtro-producto"
            onClick={() => setPickerOpen(true)}
          >
            <PackageSearch aria-hidden="true" />
            Elegir producto
          </Button>
        )}
      </div>
    ) : null;

  const reportFilters = (() => {
    switch (url.report) {
      case "issued-documents":
        return (
          <>
            {dateFilters}
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="filtro-tipo">Tipo de comprobante</Label>
              <Select
                id="filtro-tipo"
                value={url.documentType}
                onChange={(event) => url.update({ tipo: event.target.value })}
              >
                <option value="">Todos</option>
                {EMITTED_DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {DOCUMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </div>
            {stateFilter}
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="filtro-establecimiento">Establecimiento</Label>
              <Select
                id="filtro-establecimiento"
                value={url.establishmentId}
                onChange={(event) =>
                  url.update({ establecimiento: event.target.value, punto: null })
                }
              >
                <option value="">Todos</option>
                {establishmentOptions.map((establishment) => (
                  <option key={establishment.id} value={establishment.id}>
                    {establishment.code} · {establishment.address}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-0.5">
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
            {environmentFilter}
          </>
        );
      case "invoices":
        return (
          <>
            {dateFilters}
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="filtro-cliente">Identificación del cliente</Label>
              <Input
                id="filtro-cliente"
                inputMode="numeric"
                value={customerDraft}
                onChange={(event) => setCustomerDraft(event.target.value)}
              />
            </div>
            {stateFilter}
            {environmentFilter}
          </>
        );
      case "withholdings":
        return (
          <>
            {dateFilters}
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="filtro-sujeto">Identificación del sujeto retenido</Label>
              <Input
                id="filtro-sujeto"
                inputMode="numeric"
                value={supplierDraft}
                onChange={(event) => setSupplierDraft(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="filtro-periodo">Período fiscal</Label>
              <Select
                id="filtro-periodo"
                value={url.period}
                onChange={(event) => url.update({ periodo: event.target.value })}
              >
                <option value="">Todos</option>
                {(url.period && !months.includes(url.period)
                  ? [url.period, ...months]
                  : months
                ).map((month) => (
                  <option key={month} value={month}>
                    {monthLabel(month)}
                  </option>
                ))}
              </Select>
            </div>
            {stateFilter}
            {environmentFilter}
          </>
        );
      case "inventory-balances":
        return productFilter;
      case "inventory-movements":
        return (
          <>
            {productFilter}
            {dateFilters}
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="filtro-movimiento">Tipo de movimiento</Label>
              <Select
                id="filtro-movimiento"
                value={url.movementType}
                onChange={(event) => url.update({ movimiento: event.target.value })}
              >
                <option value="">Todos</option>
                {STOCK_MOVEMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {STOCK_MOVEMENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </div>
          </>
        );
      case "parties":
        return (
          <>
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="filtro-rol">Rol</Label>
              <Select
                id="filtro-rol"
                value={url.role}
                onChange={(event) => url.update({ rol: event.target.value })}
              >
                <option value="">Todos</option>
                {PARTY_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {PARTY_ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="filtro-identificacion">Identificación</Label>
              <Input
                id="filtro-identificacion"
                inputMode="numeric"
                value={identificationDraft}
                onChange={(event) => setIdentificationDraft(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="filtro-estado-tercero">Estado</Label>
              <Select
                id="filtro-estado-tercero"
                value={stateValue}
                onChange={(event) => url.update({ estado: event.target.value })}
              >
                <option value="ACTIVE">Activos</option>
                <option value="INACTIVE">Inactivos</option>
                <option value="ALL">Todos</option>
              </Select>
            </div>
          </>
        );
    }
  })();

  const total = rangeError ? 0 : (report.data?.meta.total ?? 0);
  const tableState = rangeError ? (
    <EmptyState
      kind="no-matches"
      title="Revisa el rango de fechas"
      description="La fecha final no puede ser anterior a la inicial."
    />
  ) : report.isError ? (
    <ErrorState message="No pudimos cargar el reporte." onRetry={() => void report.refetch()} />
  ) : report.data && rows.length === 0 ? (
    filtersActive ? (
      <EmptyState
        kind="no-matches"
        title="No hay registros con estos filtros"
        description="Prueba con otro rango de fechas u otro estado, o quita los filtros."
        action={
          <Button variant="outline" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        }
      />
    ) : (
      <EmptyState
        kind="empty"
        title="Todavía no hay registros"
        description="Este reporte se llena con lo que la empresa registra en el sistema."
      />
    )
  ) : undefined;

  return (
    <section aria-labelledby="reportes-titulo" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 id="reportes-titulo" className="text-3xl font-bold">
          Reportes
        </h1>
        {canExport ? (
          <div className="flex flex-col items-end gap-0.5">
            <Button
              onClick={runExport}
              disabled={exportReport.isPending || rangeError !== null || report.isPending}
              aria-busy={exportReport.isPending}
            >
              {exportReport.isPending ? (
                <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
              ) : (
                <Download aria-hidden="true" />
              )}
              {exportReport.isPending ? "Generando XLSX…" : "Exportar XLSX"}
            </Button>
          </div>
        ) : null}
      </div>
      {exportProblem?.key === filterKey ? (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-1 text-sm">
          {exportProblem.message}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="reporte">Reporte</Label>
          <Select
            id="reporte"
            value={url.reportParam}
            onChange={(event) => chooseReport(event.target.value as ReportParam)}
          >
            {REPORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        {url.reportParam === "inventario" ? (
          <div className="flex flex-col gap-0.5">
            <span id="vista-inventario" className="text-sm font-medium">
              Vista
            </span>
            <SegmentedControl
              aria-labelledby="vista-inventario"
              options={INVENTORY_VIEWS}
              value={url.view}
              onChange={(view) => url.update({ ...cleared, vista: view })}
            />
          </div>
        ) : null}
        <p className="text-sm text-foreground-muted" aria-live="polite">
          <span className="font-medium text-foreground tabular-nums">
            {new Intl.NumberFormat("es-EC").format(total)}
          </span>{" "}
          {total === 1 ? "registro" : "registros"}
          {hasEnvironment(url.report) && effectiveEnvironment
            ? ` · Ambiente: ${REPORT_ENVIRONMENT_LABELS[effectiveEnvironment]}`
            : null}
        </p>
      </div>
      <p className="flex items-start gap-0.5 text-sm text-foreground-muted">
        <Info aria-hidden="true" className="mt-0.25 size-2 shrink-0" />
        {REPORT_NOTICE}
      </p>
      <AppDataTable
        label={REPORT_LABELS[url.report]}
        columns={presentation.columns}
        data={rangeError ? [] : rows}
        getRowId={presentation.rowId}
        total={total}
        page={url.page}
        pageSize={url.pageSize}
        onPageChange={(page) => url.update({ pagina: String(page) }, false)}
        onPageSizeChange={(size) => url.update({ filas: String(size) })}
        columnVisibility={{}}
        loading={!rangeError && report.isPending}
        refreshing={report.isFetching}
        state={tableState}
        toolbar={
          <div className="flex flex-col gap-1.5">
            <Button
              variant="outline"
              className="w-fit md:hidden"
              aria-expanded={filtersOpen}
              aria-controls="filtros-reporte"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <SlidersHorizontal aria-hidden="true" />
              Filtros
            </Button>
            <div
              id="filtros-reporte"
              className={`${filtersOpen ? "grid" : "hidden"} grid-cols-1 gap-1 sm:grid-cols-2 md:grid md:grid-cols-3 xl:grid-cols-4`}
            >
              {reportFilters}
            </div>
            {filtersActive ? (
              <Button variant="ghost" className="w-fit" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            ) : null}
          </div>
        }
        renderCard={presentation.card}
      />
      <EntityPickerDialog<ProductView>
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Elegir producto"
        searchLabel="Buscar por código o nombre"
        queryKey={["reports", "products"]}
        fetchPage={fetchProducts}
        getKey={(product) => product.id}
        getLabel={(product) => product.name}
        renderItem={(product) => (
          <span className="flex flex-col">
            <span className="break-words">{product.name}</span>
            {product.mainCode ? (
              <span className="text-xs text-foreground-muted tabular-nums">{product.mainCode}</span>
            ) : null}
          </span>
        )}
        onSelect={(product) => {
          setPickedProduct(product);
          url.update({ producto: product.id });
        }}
        emptyTitle="No hay productos que coincidan"
      />
    </section>
  );
}

export function ReportsSkeleton() {
  return (
    <section aria-busy="true" className="flex flex-col gap-3">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-30 w-full" />
    </section>
  );
}

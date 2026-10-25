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
import { DataTableCard } from "@/components/data-table/data-table-card";
import {
  DataTableSelectFilter,
  type SelectFilterOption,
} from "@/components/data-table/data-table-select-filter";
import { DatePickerField } from "@/components/date-picker-field";
import { EntityPickerDialog } from "@/components/entity-picker-dialog";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
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
  { value: "terceros", label: REPORT_LABELS.parties },
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

const CARD = {
  title: "Reportes",
  titleId: "reportes-titulo",
  description: "Consulta lo que registra la empresa y expórtalo a una hoja de cálculo.",
};
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

/** Un parámetro del reporte se reparte la fila con los demás: al menos 12 rem, a todo el ancho. */
const FIELD = "w-full md:w-auto md:flex-[1_1_12rem]";

/** Desplegable de un parámetro, del tamaño de «Exportar XLSX» (decisión del propietario, 2026-10-24). */
function ReportSelect({
  label,
  value,
  options,
  onChange,
  allLabel,
  disabled,
}: {
  label: string;
  value: string;
  options: SelectFilterOption<string>[];
  onChange: (value: string) => void;
  /** La opción que quita el filtro (valor ""); sin ella, las opciones ya incluyen «Todos». */
  allLabel?: string;
  disabled?: boolean;
}) {
  return allLabel === undefined ? (
    <DataTableSelectFilter
      label={label}
      grow
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
    />
  ) : (
    <DataTableSelectFilter
      label={label}
      grow
      value={value || undefined}
      allLabel={allLabel}
      options={options}
      onChange={(next) => onChange(next ?? "")}
      disabled={disabled}
    />
  );
}

/** Una identificación que se escribe, con su etiqueta como texto de ejemplo y para la asistencia. */
function ReportInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={FIELD}>
      <Label htmlFor={id} className="sr-only">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-lg"
      />
    </div>
  );
}

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
      <DataTableCard {...CARD}>
        <div className="px-4 pb-4">
          <EmptyState
            kind="no-permission"
            title="No tienes acceso a Reportes"
            description="Pide a un administrador que revise tu rol."
          />
        </div>
      </DataTableCard>
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
      <ReportSelect
        label="Mes"
        value={selectedMonth ?? ""}
        allLabel={url.from || url.to ? "Rango elegido" : "Todas las fechas"}
        options={months.map((month) => ({ value: month, label: monthLabel(month) }))}
        onChange={(month) => {
          if (!month) return url.update({ desde: null, hasta: null });
          const range = monthRange(month);
          url.update({ desde: range.from, hasta: range.to });
        }}
      />
      <DatePickerField
        compact
        label="Desde"
        value={url.from}
        max={url.to || undefined}
        onChange={(value) => url.update({ desde: value })}
        className={FIELD}
      />
      <DatePickerField
        compact
        label="Hasta"
        value={url.to}
        min={url.from || undefined}
        error={rangeError}
        onChange={(value) => url.update({ hasta: value })}
        className={FIELD}
      />
    </>
  ) : null;

  const stateFilter = hasState(url.report) ? (
    <ReportSelect
      label="Estado"
      value={stateValue}
      options={[
        { value: "ALL", label: "Todos" },
        ...DOCUMENT_STATES.map((state) => ({ value: state, label: INVOICE_STATE_LABELS[state] })),
      ]}
      onChange={(value) => url.update({ estado: value })}
    />
  ) : null;

  const environmentFilter = hasEnvironment(url.report) ? (
    <ReportSelect
      label="Ambiente"
      value={url.environment ?? ""}
      allLabel="Vigente de la empresa"
      options={[
        { value: "pruebas", label: "Pruebas" },
        { value: "produccion", label: "Producción" },
        { value: "todos", label: "Pruebas y Producción" },
      ]}
      onChange={(value) => url.update({ ambiente: value })}
    />
  ) : null;

  const productFilter =
    url.report === "inventory-balances" || url.report === "inventory-movements" ? (
      <div className={FIELD}>
        <span className="sr-only" id="filtro-producto">
          Producto
        </span>
        {url.productId ? (
          <span className="flex h-8 items-center gap-1 rounded-lg border border-input px-2 text-sm max-md:h-11">
            <PackageSearch aria-hidden="true" className="size-4 shrink-0 text-foreground-muted" />
            <span className="min-w-0 flex-1 truncate">{productName}</span>
            <Button
              variant="ghost"
              size="legacy-icon-sm"
              onClick={() => url.update({ producto: null })}
              aria-label="Quitar el filtro de producto"
            >
              <X aria-hidden="true" />
            </Button>
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start"
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
            <ReportSelect
              label="Tipo"
              value={url.documentType}
              allLabel="Todos"
              options={EMITTED_DOCUMENT_TYPES.map((type) => ({
                value: type,
                label: DOCUMENT_TYPE_LABELS[type],
              }))}
              onChange={(value) => url.update({ tipo: value })}
            />
            {stateFilter}
            <ReportSelect
              label="Establecimiento"
              value={url.establishmentId}
              allLabel="Todos"
              options={establishmentOptions.map((establishment) => ({
                value: establishment.id,
                label: `${establishment.code} · ${establishment.address}`,
              }))}
              onChange={(value) => url.update({ establecimiento: value, punto: null })}
            />
            <ReportSelect
              label="Punto de emisión"
              value={url.emissionPointId}
              allLabel="Todos"
              disabled={!selectedEstablishment}
              options={
                selectedEstablishment?.emissionPoints.map((point) => ({
                  value: point.id,
                  label: pointLabel(selectedEstablishment, point),
                })) ?? []
              }
              onChange={(value) => url.update({ punto: value })}
            />
            {environmentFilter}
          </>
        );
      case "invoices":
        return (
          <>
            {dateFilters}
            <ReportInput
              id="filtro-cliente"
              label="Identificación del cliente"
              value={customerDraft}
              onChange={setCustomerDraft}
            />
            {stateFilter}
            {environmentFilter}
          </>
        );
      case "withholdings":
        return (
          <>
            {dateFilters}
            <ReportInput
              id="filtro-sujeto"
              label="Identificación del sujeto retenido"
              value={supplierDraft}
              onChange={setSupplierDraft}
            />
            <ReportSelect
              label="Período fiscal"
              value={url.period}
              allLabel="Todos"
              options={(url.period && !months.includes(url.period)
                ? [url.period, ...months]
                : months
              ).map((month) => ({ value: month, label: monthLabel(month) }))}
              onChange={(value) => url.update({ periodo: value })}
            />
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
            <ReportSelect
              label="Tipo de movimiento"
              value={url.movementType}
              allLabel="Todos"
              options={STOCK_MOVEMENT_TYPES.map((type) => ({
                value: type,
                label: STOCK_MOVEMENT_TYPE_LABELS[type],
              }))}
              onChange={(value) => url.update({ movimiento: value })}
            />
          </>
        );
      case "parties":
        return (
          <>
            <ReportSelect
              label="Rol"
              value={url.role}
              allLabel="Todos"
              options={PARTY_ROLES.map((role) => ({ value: role, label: PARTY_ROLE_LABELS[role] }))}
              onChange={(value) => url.update({ rol: value })}
            />
            <ReportInput
              id="filtro-identificacion"
              label="Identificación"
              value={identificationDraft}
              onChange={setIdentificationDraft}
            />
            <ReportSelect
              label="Estado"
              value={stateValue}
              options={[
                { value: "ACTIVE", label: "Activos" },
                { value: "INACTIVE", label: "Inactivos" },
                { value: "ALL", label: "Todos" },
              ]}
              onChange={(value) => url.update({ estado: value })}
            />
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
    <>
      <DataTableCard
        {...CARD}
        actions={
          <>
            {/* El reporte y su vista, a la izquierda de «Exportar XLSX» y de su tamaño
                (decisión del propietario, 2026-10-24). */}
            <DataTableSelectFilter<ReportParam>
              label="Reporte"
              value={url.reportParam}
              options={REPORT_OPTIONS}
              onChange={chooseReport}
            />
            {url.reportParam === "inventario" ? (
              <DataTableSelectFilter<InventoryView>
                label="Vista"
                value={url.view}
                options={INVENTORY_VIEWS}
                onChange={(view) => url.update({ ...cleared, vista: view })}
              />
            ) : null}
            {canExport ? (
              <Button
                size="sm"
                className="max-md:w-full"
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
            ) : null}
          </>
        }
        lead={
          <div className="flex flex-col gap-2 empty:hidden">
            {exportProblem?.key === filterKey ? (
              <p
                role="alert"
                className="rounded-md border border-warning/40 bg-warning/10 p-2 text-sm"
              >
                {exportProblem.message}
              </p>
            ) : null}
            <p className="flex items-start gap-1 text-sm text-foreground-muted">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {REPORT_NOTICE}
            </p>
          </div>
        }
        filters={
          <>
            <p className="text-sm text-foreground-muted" aria-live="polite">
              <span className="font-medium text-foreground tabular-nums">
                {new Intl.NumberFormat("es-EC").format(total)}
              </span>{" "}
              {total === 1 ? "registro" : "registros"}
              {hasEnvironment(url.report) && effectiveEnvironment
                ? ` · Ambiente: ${REPORT_ENVIRONMENT_LABELS[effectiveEnvironment]}`
                : null}
            </p>
            {/* Los parámetros del reporte, del tamaño de «Exportar XLSX», se reparten la fila
                (decisión del propietario, 2026-10-24); en un teléfono se pliegan tras «Filtros». */}
            <div className="flex w-full flex-col gap-3">
              <Button
                variant="outline"
                size="sm"
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
                className={`${filtersOpen ? "flex" : "hidden"} flex-col gap-2 md:flex md:flex-row md:flex-wrap`}
              >
                {reportFilters}
              </div>
              {filtersActive ? (
                <Button variant="ghost" size="sm" className="w-fit" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              ) : null}
            </div>
          </>
        }
      >
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
          renderCard={presentation.card}
        />
      </DataTableCard>
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
    </>
  );
}

export function ReportsSkeleton() {
  return (
    <DataTableCard {...CARD} busy>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-60 w-full" />
      </div>
    </DataTableCard>
  );
}

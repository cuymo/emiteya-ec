// Catálogos fiscales (add-fiscal-catalogs, design D17). Usuario: administrador (cambia) u operador
// (consulta). Objetivo: usar solo las entradas oficiales que corresponden a la empresa y saber de
// dónde salen. Decisión: qué tarifas y formas de pago habilitar. Acción: el Switch de cada entrada.
// P0: IVA y formas de pago. P1: ICE, IRBPNR y la fuente. P2: identificación, consumidor final, matriz
// y esquemas, de solo lectura. P3 (historial de datasets): fuera. La política de tamaño de la
// transmisión no es un catálogo oficial (adopt-conservative-sri-transmission-size-policy-v1).
// Los catálogos de retención (add-withholding-receipts, design D24) muestran la clasificación de cada
// entrada y, en las fuera de alcance, su razón, sin habilitación: solo los conceptos de renta y los
// códigos de IVA soportados se habilitan por empresa.
// Cada catálogo es una sección de ajustes (decisión del propietario, 2026-10-16): su título, su
// descripción y su fuente a la izquierda, sus entradas a la derecha y un separador entre secciones.
// La pestaña ya nombra la pantalla: el título queda solo para los lectores de pantalla.
"use client";

import {
  DOCUMENT_TYPE_LABELS,
  type CatalogEntryView,
  type FiscalCatalogSummaryView,
  type FiscalCatalogType,
  type ScopeClassification,
  type SpecialCaseCategory,
} from "@facturador/contracts";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SettingsSection, SettingsSections } from "@/components/layout/settings-section";
import { errorMessage } from "@/components/feedback";
import { useSession } from "@/components/session";
import { EmptyState, ErrorState, Skeleton, StatusBadge } from "@/components/states";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatPercentage, formatUsd } from "@/lib/decimal";
import { canSee } from "@/lib/permissions";
import { useProductTaxSummary } from "@/features/products/products-api";
import {
  entryLabel,
  formatIsoDate,
  sourceName,
  startDescription,
  useCatalogEntries,
  useCatalogSummaries,
  useConsumerFinalPolicy,
  useSchemaRegistry,
  useSetEnablement,
  useSpecialCases,
} from "./catalogs-api";

const CATEGORY_LABELS: Record<SpecialCaseCategory, string> = {
  CORE: "Alcance del MVP",
  CONDITIONAL_ISSUER_RULE: "Condición del emisor",
  CONDITIONAL_GO_LIVE: "Condición del go-live",
  NOT_APPLICABLE: "No aplica",
  OUT_OF_MVP: "Fuera del MVP",
};

/** Lo que dice la tarifa según la semántica de su impuesto (design D8). */
function rateDescription(entry: CatalogEntryView): string | null {
  const rate = (entry.applicable ?? entry.versions.at(-1))?.rate;
  if (!rate) return null;
  switch (rate.rateKind) {
    case "PERCENTAGE":
      return formatPercentage(rate.percentage ?? "0");
    case "NOT_SUBJECT":
      return "No objeto de impuesto";
    case "EXEMPT":
      return "Exento";
    case "DIFFERENTIATED":
      return "Diferenciado: sin tarifa fija en la ficha";
    case "PER_NORMATIVE":
      return "Tarifa según la normativa vigente; no está en el catálogo";
    case "PER_UNIT":
      return "Sin tarifa transcrita";
  }
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Etiqueta de la clasificación: soportada o fuera de alcance. */
const scopeLabel = (classification: ScopeClassification) =>
  classification.startsWith("SUPPORTED") ? "Soportada" : "Fuera de alcance";

/** Razón de una entrada fuera de alcance, con el texto de la spec de cada catálogo. */
function scopeReason(catalogType: FiscalCatalogType, classification: ScopeClassification) {
  switch (classification) {
    case "OUT_OF_SCOPE_NON_RESIDENT":
      return "Por no residente: los pagos al exterior están fuera del alcance actual.";
    case "OUT_OF_SCOPE_VARIABLE":
      return "Por porcentaje variable: la fuente publica un porcentaje variable o textual, no uno fijo.";
    case "OUT_OF_SCOPE_SPECIAL_STRUCTURE":
      return "Por estructura especial excluida: exige datos que el comprobante del sistema no emite.";
    case "OUT_OF_SCOPE_AMBIGUOUS_REPRESENTATION":
      return catalogType === "withholding-iva-code"
        ? "La fuente no define su representación en el comprobante."
        : "Por representación ambigua en la fuente: no establece la representación exacta de su código; pendiente de evidencia y de soporte futuro.";
    case "OUT_OF_SCOPE_PENDING_EVIDENCE":
      return "Pendiente de evidencia oficial para emitirla; soporte futuro.";
    case "OUT_OF_SCOPE_MVP":
      return "No forma parte del alcance actual.";
    case "OUT_OF_SCOPE_EXPIRED":
      return "Ya no está vigente.";
    default:
      return null;
  }
}

function SourceLine({ summary }: { summary: FiscalCatalogSummaryView | undefined }) {
  if (!summary) return null;
  if (!summary.source.document.startsWith("Ficha técnica")) {
    return (
      <p className="text-xs text-foreground-muted">
        Fuente: {sourceName(summary.source)}, versión {summary.datasetVersion} del catálogo.
        <span className="block break-all">SHA-256 del archivo: {summary.source.sha256}</span>
      </p>
    );
  }
  return (
    <p className="text-xs text-foreground-muted">
      Fuente: ficha técnica del SRI v{summary.source.version} (
      {formatIsoDate(summary.source.publishedOn)}), versión {summary.datasetVersion} del catálogo.
    </p>
  );
}

function EntryRow({
  catalogType,
  entry,
  source,
  canManage,
  usage,
}: {
  catalogType: FiscalCatalogType;
  entry: CatalogEntryView;
  source: FiscalCatalogSummaryView["source"];
  canManage: boolean;
  /** Productos activos que usan la entrada (add-parties-and-products, design D17). */
  usage: number;
}) {
  const labelId = useId();
  const setEnablement = useSetEnablement();
  const [confirming, setConfirming] = useState(false);
  const products = usage === 1 ? "1 producto activo" : `${usage} productos activos`;
  const version = entry.applicable ?? entry.versions.at(-1)!;
  const rate = rateDescription(entry);
  const scope = version.withholding;
  const classification = scope
    ? {
        label: scopeLabel(scope.scopeClassification),
        reason: scopeReason(catalogType, scope.scopeClassification),
      }
    : null;
  const admitted = scope?.allowedSupportCodes ?? null;
  const withholdingRate = scope?.percentage
    ? formatPercentage(scope.percentage)
    : (scope?.rateText ?? null);
  // Una entrada de retención fuera de alcance no se elige ni se habilita: no lleva control.
  const enableable = entry.enablement.source !== "NOT_ENABLEABLE" && (scope?.selectable ?? true);
  return (
    <li className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 flex-col gap-1 text-sm">
        <span id={labelId} className="font-medium break-words">
          {entryLabel(entry)}
        </span>
        <span className="text-foreground-muted">
          Código <span className="tabular-nums">{entry.code}</span>
          {entry.entryKey !== entry.code ? ` · variante ${entry.entryKey}` : ""}
          {rate ? ` · ${rate}` : ""}
          {withholdingRate ? ` · ${withholdingRate}` : ""}
        </span>
        {classification && (
          <span className="flex flex-col gap-1">
            <span>
              <StatusBadge
                tone={scope?.selectable ? "success" : "neutral"}
                label={classification.label}
              />
            </span>
            {classification.reason && (
              <span className="text-xs text-foreground-muted">{classification.reason}</span>
            )}
          </span>
        )}
        {admitted && (
          <span className="text-xs text-foreground-muted">
            Sustentos admitidos:{" "}
            <span className="tabular-nums">
              {admitted.length > 0 ? admitted.join(", ") : "ninguno"}
            </span>
          </span>
        )}
        <span className="text-xs text-foreground-muted">
          {startDescription(version, source)}
          {version.effectiveTo ? ` · hasta ${formatIsoDate(version.effectiveTo)}` : ""}
        </span>
        {usage > 0 && <span className="text-xs text-foreground-muted">Usada por {products}</span>}
        {entry.applicable === null && (
          <span>
            <StatusBadge tone="warning" label="No vigente hoy" />
          </span>
        )}
      </div>
      {enableable && (
        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-start">
          <span className="text-sm text-foreground-muted" aria-hidden="true">
            {entry.enablement.enabled ? "Habilitada" : "Deshabilitada"}
          </span>
          <Switch
            checked={entry.enablement.enabled}
            disabled={!canManage || setEnablement.isPending}
            aria-labelledby={labelId}
            aria-describedby={canManage ? undefined : `${labelId}-readonly`}
            onCheckedChange={(enabled) => {
              // Deshabilitar una entrada en uso deja esos productos en revisión: se confirma antes.
              if (!enabled && usage > 0) setConfirming(true);
              else setEnablement.mutate({ catalogType, entry, enabled });
            }}
          />
          {!canManage && (
            <span id={`${labelId}-readonly`} className="sr-only">
              Solo un administrador cambia la habilitación.
            </span>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`¿Deshabilitar ${entryLabel(entry)}?`}
        description={`La usan ${products}: ${usage === 1 ? "pasará" : "pasarán"} a Revisar impuestos hasta que la habilites otra vez o les asignes otra entrada.`}
        confirmLabel="Deshabilitar"
        pending={setEnablement.isPending}
        onConfirm={() =>
          setEnablement.mutate(
            { catalogType, entry, enabled: false },
            { onSettled: () => setConfirming(false) },
          )
        }
      />
    </li>
  );
}

function CatalogSection({
  catalogType,
  title,
  description,
  summary,
  canManage,
  filterable = false,
  usage,
}: {
  catalogType: FiscalCatalogType;
  title: string;
  description: ReactNode;
  summary: FiscalCatalogSummaryView | undefined;
  canManage: boolean;
  filterable?: boolean;
  /** Productos activos por entrada; vacío si el catálogo no lo usan productos. */
  usage: ReadonlyMap<string, number>;
}) {
  const entries = useCatalogEntries(catalogType, true);
  const [filter, setFilter] = useState("");
  const filterId = useId();
  const visible = (entries.data?.entries ?? []).filter((entry) => {
    if (!filter.trim()) return true;
    const needle = normalize(filter.trim());
    return normalize(`${entry.code} ${entry.entryKey} ${entryLabel(entry)}`).includes(needle);
  });
  return (
    <SettingsSection
      title={title}
      description={description}
      aside={<SourceLine summary={summary} />}
    >
      {filterable && (
        <div className="flex max-w-sm flex-col gap-1">
          <label htmlFor={filterId} className="text-sm font-medium">
            Filtrar por código o denominación<span className="sr-only"> en {title}</span>
          </label>
          <Input
            id={filterId}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      )}
      {entries.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : entries.isError ? (
        <ErrorState message={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />
      ) : visible.length === 0 ? (
        <p className="text-sm text-foreground-muted">Ninguna entrada coincide con el filtro.</p>
      ) : (
        <ul
          aria-label={title}
          className="divide-y divide-border rounded-lg border border-border bg-surface"
        >
          {visible.map((entry) => (
            <EntryRow
              key={entry.entryKey}
              catalogType={catalogType}
              entry={entry}
              source={entries.data.catalog.source}
              canManage={canManage}
              usage={usage.get(entry.entryKey) ?? 0}
            />
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

function ReadOnlyGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-border bg-surface">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium">
        {title}
      </summary>
      <div className="border-t border-border px-3 py-2 text-sm">{children}</div>
    </details>
  );
}

function ConsumerFinalPolicy() {
  const policy = useConsumerFinalPolicy(true);
  if (policy.isPending) return <Skeleton className="h-16 w-full" />;
  if (policy.isError)
    return (
      <ErrorState message={errorMessage(policy.error)} onRetry={() => void policy.refetch()} />
    );
  const applicable = policy.data.applicable;
  if (!applicable) return <p>No hay una política vigente hoy.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
      <dt className="text-foreground-muted">Monto máximo sin identificar al comprador</dt>
      <dd className="tabular-nums">{formatUsd(applicable.maxAmount)}</dd>
      <dt className="text-foreground-muted">Identificación</dt>
      <dd className="tabular-nums">
        Tipo {applicable.identificationType} · {applicable.identification}
      </dd>
      <dt className="text-foreground-muted">Razón social</dt>
      <dd>{applicable.canonicalName}</dd>
      <dt className="text-foreground-muted">Inicio</dt>
      <dd>
        {applicable.effectiveFromBasis === "SOURCE_STATED"
          ? `Desde ${formatIsoDate(applicable.effectiveFrom)} (declarada por la fuente)`
          : `Base del proyecto: ficha v${policy.data.source.version} (${formatIsoDate(applicable.effectiveFrom)})`}
      </dd>
      <dt className="text-foreground-muted">Fuente</dt>
      <dd>{applicable.sourceRef}</dd>
    </dl>
  );
}

function IdentificationTypes() {
  const entries = useCatalogEntries("identification-type", true);
  if (entries.isPending) return <Skeleton className="h-16 w-full" />;
  if (entries.isError)
    return (
      <ErrorState message={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />
    );
  return (
    <ul aria-label="Tipos de identificación" className="flex flex-col gap-1">
      {entries.data.entries.map((entry) => {
        const rule = entry.applicable?.identificationRule;
        return (
          <li key={entry.entryKey}>
            <span className="font-medium">
              {entry.code} · {entryLabel(entry)}
            </span>
            {rule && (
              <span className="text-foreground-muted">
                {" "}
                — {rule.description}
                {rule.reservedFor ? " (no disponible para registrar terceros)" : ""}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SpecialCases() {
  const cases = useSpecialCases(true);
  if (cases.isPending) return <Skeleton className="h-16 w-full" />;
  if (cases.isError)
    return <ErrorState message={errorMessage(cases.error)} onRetry={() => void cases.refetch()} />;
  return (
    <ul aria-label="Matriz de casos especiales" className="flex flex-col gap-1">
      {cases.data.map((annex) => (
        <li key={annex.annex} className="flex flex-wrap items-baseline gap-x-2">
          <span className="tabular-nums font-medium">Anexo {annex.annex}</span>
          <span>{annex.topic}</span>
          <span className="text-foreground-muted">· {CATEGORY_LABELS[annex.category]}</span>
        </li>
      ))}
    </ul>
  );
}

function Schemas() {
  const schemas = useSchemaRegistry(true);
  if (schemas.isPending) return <Skeleton className="h-16 w-full" />;
  if (schemas.isError)
    return (
      <ErrorState message={errorMessage(schemas.error)} onRetry={() => void schemas.refetch()} />
    );
  return (
    <ul aria-label="Esquemas XSD registrados" className="flex flex-col gap-4">
      {schemas.data.map((schema) => (
        <li key={schema.path} className="flex flex-col">
          <p>
            <span className="font-medium">
              {schema.kind === "IMPORT"
                ? `Esquema importado, revisión ${schema.revision ?? ""}`
                : `${DOCUMENT_TYPE_LABELS[schema.documentType as keyof typeof DOCUMENT_TYPE_LABELS]} ${schema.version ?? ""}`}
            </span>
            <span className="text-foreground-muted">
              {" "}
              · {schema.file} · {schema.supported ? "soportado" : "no soportado"}
            </span>
          </p>
          <p className="text-foreground-muted">Fuente: {schema.source}</p>
          <p className="break-all font-mono text-xs text-foreground-muted">
            SHA-256 {schema.sha256}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function FiscalCatalogsScreen() {
  const { me } = useSession();
  const allowed = canSee(me.role, "fiscalCatalogs.read");
  const canManage = canSee(me.role, "fiscalCatalogs.manage");
  const summaries = useCatalogSummaries(allowed);
  // Recuentos de productos compuestos desde su API pública: catalogs no consulta productos (D17).
  const productSummary = useProductTaxSummary(allowed && canSee(me.role, "products.read"));
  const usageOf = (catalogType: FiscalCatalogType): ReadonlyMap<string, number> =>
    new Map(
      (productSummary.data?.byEntry ?? [])
        .filter((entry) => entry.catalogType === catalogType)
        .map((entry) => [entry.entryKey, entry.activeProducts]),
    );
  const review = productSummary.data?.byStatus.REVIEW_REQUIRED ?? 0;
  const none: ReadonlyMap<string, number> = new Map();
  // La pestaña ya nombra la pantalla: el título queda para los lectores de pantalla.
  const heading = (
    <h1 id="catalogos-titulo" className="sr-only">
      Catálogos fiscales
    </h1>
  );

  if (!allowed) {
    return (
      <section aria-labelledby="catalogos-titulo" className="flex flex-col gap-6">
        {heading}
        <EmptyState
          kind="no-permission"
          title="No tienes permiso para ver esta sección"
          description="Los catálogos fiscales los consultan administradores y operadores."
        />
      </section>
    );
  }
  if (summaries.isPending) {
    return (
      <section aria-labelledby="catalogos-titulo" aria-busy="true" className="flex flex-col gap-6">
        {heading}
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }
  if (summaries.isError) {
    return (
      <section aria-labelledby="catalogos-titulo" className="flex flex-col gap-6">
        {heading}
        <ErrorState
          message={errorMessage(summaries.error)}
          onRetry={() => void summaries.refetch()}
        />
      </section>
    );
  }
  const summary = (type: FiscalCatalogType) =>
    summaries.data.find((catalog) => catalog.catalogType === type);
  return (
    <section aria-labelledby="catalogos-titulo" className="flex flex-col gap-8">
      {heading}
      <div className="flex flex-col gap-2">
        <p className="text-sm text-foreground-muted">
          Datos oficiales del SRI que trae esta versión del producto. Los códigos, las
          denominaciones, las tarifas y las vigencias no se editan:{" "}
          {canManage
            ? "elige qué entradas usa tu empresa."
            : "solo un administrador elige qué entradas usa la empresa."}
        </p>
        {review > 0 && (
          <p role="note" className="text-sm">
            <StatusBadge
              tone="warning"
              label={`${review} ${review === 1 ? "producto necesita" : "productos necesitan"} revisión`}
            />{" "}
            <Link href="/productos?tributario=revisar" className="text-primary underline">
              Ver en Productos
            </Link>
          </p>
        )}
      </div>
      <SettingsSections>
        <CatalogSection
          catalogType="iva-rate"
          title="Tarifas de IVA"
          description="Las tarifas habilitadas son las que la empresa podrá asignar a sus productos."
          summary={summary("iva-rate")}
          canManage={canManage}
          usage={usageOf("iva-rate")}
        />
        <CatalogSection
          catalogType="payment-method"
          title="Formas de pago"
          description="Las formas de pago habilitadas son las que se ofrecerán al emitir."
          summary={summary("payment-method")}
          canManage={canManage}
          usage={none}
        />
        <CatalogSection
          catalogType="ice-rate"
          title="ICE"
          description="Habilita solo los códigos de ICE que tu empresa factura. La ficha no publica sus tarifas vigentes."
          summary={summary("ice-rate")}
          canManage={canManage}
          usage={usageOf("ice-rate")}
          filterable
        />
        <CatalogSection
          catalogType="irbpnr-rate"
          title="IRBPNR"
          description="Impuesto redimible a las botellas plásticas no retornables."
          summary={summary("irbpnr-rate")}
          canManage={canManage}
          usage={usageOf("irbpnr-rate")}
        />
        <CatalogSection
          catalogType="withholding-income-concept"
          title="Conceptos de retención de la renta"
          description="Del Catálogo ATS. Solo los conceptos de residentes con porcentaje fijo se pueden usar en una retención; los demás muestran por qué están fuera de alcance."
          summary={summary("withholding-income-concept")}
          canManage={canManage}
          usage={none}
          filterable
        />
        <CatalogSection
          catalogType="withholding-iva-code"
          title="Códigos de retención del IVA"
          description="Habilita los códigos de retención del IVA que usa tu empresa."
          summary={summary("withholding-iva-code")}
          canManage={canManage}
          usage={none}
        />
        <CatalogSection
          catalogType="withholding-tax"
          title="Impuestos a retener"
          description="Renta e IVA se retienen; el ISD queda pendiente de evidencia."
          summary={summary("withholding-tax")}
          canManage={canManage}
          usage={none}
        />
        <CatalogSection
          catalogType="support-document-type"
          title="Tipos de documento sustento"
          description="Del Catálogo ATS. Una retención acepta facturas, notas de venta y liquidaciones de compra."
          summary={summary("support-document-type")}
          canManage={canManage}
          usage={none}
          filterable
        />
        <CatalogSection
          catalogType="support-code"
          title="Sustentos tributarios"
          description="Del Catálogo ATS. Cada tipo de documento admite sus sustentos."
          summary={summary("support-code")}
          canManage={canManage}
          usage={none}
          filterable
        />
        <SettingsSection
          id="mas-datos"
          title="Más datos oficiales"
          description="De solo lectura: tipos de identificación, consumidor final, casos especiales y esquemas XSD."
        >
          <ReadOnlyGroup title="Tipos de identificación">
            <IdentificationTypes />
          </ReadOnlyGroup>
          <ReadOnlyGroup title="Consumidor final">
            <ConsumerFinalPolicy />
          </ReadOnlyGroup>
          <ReadOnlyGroup title="Casos especiales">
            <SpecialCases />
          </ReadOnlyGroup>
          <ReadOnlyGroup title="Esquemas XSD">
            <Schemas />
          </ReadOnlyGroup>
        </SettingsSection>
      </SettingsSections>
    </section>
  );
}

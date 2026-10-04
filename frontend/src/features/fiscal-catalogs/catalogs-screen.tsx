// Catálogos fiscales (add-fiscal-catalogs, design D17). Usuario: administrador (cambia) u operador
// (consulta). Objetivo: usar solo las entradas oficiales que corresponden a la empresa y saber de
// dónde salen. Decisión: qué tarifas y formas de pago habilitar. Acción: el Switch de cada entrada.
// P0: IVA y formas de pago. P1: ICE, IRBPNR y la fuente. P2: identificación, consumidor final, límite
// de tamaño del envío al SRI, matriz y esquemas, de solo lectura. P3 (historial de datasets): fuera.
"use client";

import {
  DOCUMENT_TYPE_LABELS,
  type CatalogEntryView,
  type FiscalCatalogSummaryView,
  type FiscalCatalogType,
  type SpecialCaseCategory,
} from "@facturador/contracts";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
  startDescription,
  useCatalogEntries,
  useCatalogSummaries,
  useConsumerFinalPolicy,
  useSchemaRegistry,
  useSetEnablement,
  useSpecialCases,
  useSriTransmissionPolicy,
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

function SourceLine({ summary }: { summary: FiscalCatalogSummaryView | undefined }) {
  if (!summary) return null;
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
  sourceVersion,
  canManage,
  usage,
}: {
  catalogType: FiscalCatalogType;
  entry: CatalogEntryView;
  sourceVersion: string;
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
  const enableable = entry.enablement.source !== "NOT_ENABLEABLE";
  return (
    <li className="flex flex-col gap-1 px-1.5 py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-1.5">
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span id={labelId} className="font-medium break-words">
          {entryLabel(entry)}
        </span>
        <span className="text-foreground-muted">
          Código <span className="tabular-nums">{entry.code}</span>
          {entry.entryKey !== entry.code ? ` · variante ${entry.entryKey}` : ""}
          {rate ? ` · ${rate}` : ""}
        </span>
        <span className="text-xs text-foreground-muted">
          {startDescription(version, sourceVersion)}
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
        <div className="flex shrink-0 items-center justify-between gap-1 sm:justify-start">
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
  const headingId = useId();
  const filterId = useId();
  const visible = (entries.data?.entries ?? []).filter((entry) => {
    if (!filter.trim()) return true;
    const needle = normalize(filter.trim());
    return normalize(`${entry.code} ${entry.entryKey} ${entryLabel(entry)}`).includes(needle);
  });
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="text-xl font-semibold">
        {title}
      </h2>
      <p className="text-sm text-foreground-muted">{description}</p>
      <SourceLine summary={summary} />
      {filterable && (
        <div className="flex max-w-sm flex-col gap-0.5">
          <label htmlFor={filterId} className="text-sm font-medium">
            Filtrar por código o denominación
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
        <Skeleton className="h-24 w-full" />
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
              sourceVersion={entries.data.catalog.source.version}
              canManage={canManage}
              usage={usage.get(entry.entryKey) ?? 0}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReadOnlyGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-border bg-surface">
      <summary className="flex min-h-5.5 cursor-pointer items-center px-1.5 font-medium">
        {title}
      </summary>
      <div className="border-t border-border px-1.5 py-1 text-sm">{children}</div>
    </details>
  );
}

function ConsumerFinalPolicy() {
  const policy = useConsumerFinalPolicy(true);
  if (policy.isPending) return <Skeleton className="h-8 w-full" />;
  if (policy.isError)
    return (
      <ErrorState message={errorMessage(policy.error)} onRetry={() => void policy.refetch()} />
    );
  const applicable = policy.data.applicable;
  if (!applicable) return <p>No hay una política vigente hoy.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-[auto_1fr]">
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

const bytes = new Intl.NumberFormat("es-EC");

/**
 * Límite de tamaño del envío al SRI (add-sri-transmission, design D17). Sin una fuente oficial
 * verificada la política no está publicada y no se transmite (Q-47).
 */
function SriTransmissionPolicy() {
  const policy = useSriTransmissionPolicy(true);
  if (policy.isPending) return <Skeleton className="h-8 w-full" />;
  if (policy.isError)
    return (
      <ErrorState message={errorMessage(policy.error)} onRetry={() => void policy.refetch()} />
    );
  if (!policy.data.source)
    return (
      <p>
        Pendiente de la fuente oficial: la cifra exacta del límite no se ha verificado, así que no
        hay política publicada y ningún comprobante se transmite al SRI.
      </p>
    );
  const applicable = policy.data.applicable;
  if (!applicable) return <p>No hay una política vigente hoy.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-[auto_1fr]">
      <dt className="text-foreground-muted">Tamaño máximo del comprobante firmado</dt>
      <dd className="tabular-nums">{bytes.format(applicable.maxSignedDocumentBytes)} bytes</dd>
      <dt className="text-foreground-muted">Texto de la fuente</dt>
      <dd>«{applicable.sourceText}»</dd>
      <dt className="text-foreground-muted">Sección</dt>
      <dd>{applicable.sourceSection}</dd>
      <dt className="text-foreground-muted">Unidad literal</dt>
      <dd>{applicable.literalUnit}</dd>
      <dt className="text-foreground-muted">Interpretación</dt>
      <dd>{applicable.interpretation}</dd>
      <dt className="text-foreground-muted">Inicio</dt>
      <dd>
        {applicable.effectiveFromBasis === "SOURCE_STATED"
          ? `Desde ${formatIsoDate(applicable.effectiveFrom)} (declarada por la fuente)`
          : `Base del proyecto: ficha v${policy.data.source.version} (${formatIsoDate(applicable.effectiveFrom)})`}
      </dd>
    </dl>
  );
}

function IdentificationTypes() {
  const entries = useCatalogEntries("identification-type", true);
  if (entries.isPending) return <Skeleton className="h-8 w-full" />;
  if (entries.isError)
    return (
      <ErrorState message={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />
    );
  return (
    <ul aria-label="Tipos de identificación" className="flex flex-col gap-0.5">
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
  if (cases.isPending) return <Skeleton className="h-8 w-full" />;
  if (cases.isError)
    return <ErrorState message={errorMessage(cases.error)} onRetry={() => void cases.refetch()} />;
  return (
    <ul aria-label="Matriz de casos especiales" className="flex flex-col gap-0.5">
      {cases.data.map((annex) => (
        <li key={annex.annex} className="flex flex-wrap items-baseline gap-x-1">
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
  if (schemas.isPending) return <Skeleton className="h-8 w-full" />;
  if (schemas.isError)
    return (
      <ErrorState message={errorMessage(schemas.error)} onRetry={() => void schemas.refetch()} />
    );
  return (
    <ul aria-label="Esquemas XSD registrados" className="flex flex-col gap-2">
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
  const heading = (
    <h1 id="catalogos-titulo" className="text-3xl font-bold">
      Catálogos fiscales
    </h1>
  );

  if (!allowed) {
    return (
      <section aria-labelledby="catalogos-titulo" className="flex flex-col gap-3">
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
      <section
        aria-labelledby="catalogos-titulo"
        aria-busy="true"
        className="flex max-w-3xl flex-col gap-3"
      >
        {heading}
        <Skeleton className="h-32 w-full" />
      </section>
    );
  }
  if (summaries.isError) {
    return (
      <section aria-labelledby="catalogos-titulo" className="flex max-w-3xl flex-col gap-3">
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
    <section aria-labelledby="catalogos-titulo" className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        {heading}
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
      <section aria-labelledby="mas-datos" className="flex flex-col gap-1">
        <h2 id="mas-datos" className="text-xl font-semibold">
          Más datos oficiales
        </h2>
        <ReadOnlyGroup title="Tipos de identificación">
          <IdentificationTypes />
        </ReadOnlyGroup>
        <ReadOnlyGroup title="Consumidor final">
          <ConsumerFinalPolicy />
        </ReadOnlyGroup>
        <ReadOnlyGroup title="Límite de tamaño del envío al SRI">
          <SriTransmissionPolicy />
        </ReadOnlyGroup>
        <ReadOnlyGroup title="Casos especiales">
          <SpecialCases />
        </ReadOnlyGroup>
        <ReadOnlyGroup title="Esquemas XSD">
          <Schemas />
        </ReadOnlyGroup>
      </section>
    </section>
  );
}

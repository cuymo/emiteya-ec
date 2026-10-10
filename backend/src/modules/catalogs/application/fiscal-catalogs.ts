// Consulta de los catálogos fiscales y habilitación por empresa (add-fiscal-catalogs, design D5, D9,
// D11 y D13). La vigencia se resuelve solo con resolveCatalogEntry, y la habilitación solo con
// effectiveEnablement, de modo que la ausencia de una decisión signifique siempre lo mismo.
import {
  catalogEntriesQuerySchema,
  isSelectableScope,
  setEnablementSchema,
  type CatalogEntriesView,
  type CatalogEntryVersionView,
  type CatalogEntryView,
  type CatalogSourceView,
  type ConsumerFinalPolicyView,
  type EnablementPolicy,
  type FiscalCatalogSummaryView,
  type FiscalCatalogType,
  type SchemaRegistryEntryView,
  type SpecialCaseView,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import {
  FISCAL_CATALOG_TYPES,
  isEnableable,
  isFiscalCatalogType,
} from "../domain/catalog-types.ts";
import { effectiveEnablement, isUsable } from "../domain/enablement.ts";
import {
  ecuadorDate,
  hasCurrentOrFutureVersion,
  resolveCatalogEntry,
  type IsoDate,
} from "../domain/validity.ts";
import {
  catalogNotFound,
  entryNotFound,
  entryNotInForce,
  entryNotSelectable,
  notEnableable,
} from "./errors.ts";
import type {
  AppliedDataset,
  CatalogReader,
  CatalogsUnitOfWork,
  EnablementRepository,
  StoredEntryVersion,
} from "./ports.ts";

export type FiscalCatalogsDependencies = {
  reader: CatalogReader;
  enablement: EnablementRepository;
  uow: CatalogsUnitOfWork;
  authorizer: Authorizer;
  now?: () => Date;
};

const source = (dataset: AppliedDataset): CatalogSourceView => ({
  document: dataset.sourceDocument,
  version: dataset.sourceVersion,
  publishedOn: dataset.sourcePublishedOn,
  url: dataset.sourceUrl,
  sha256: dataset.sourceSha256,
});

/** Última versión aplicada de cada dataset: rige su fuente y su política de habilitación. */
export function latestByType(applied: readonly AppliedDataset[]): Map<string, AppliedDataset> {
  const latest = new Map<string, AppliedDataset>();
  for (const dataset of applied) {
    const current = latest.get(dataset.catalogType);
    if (!current || dataset.version > current.version) latest.set(dataset.catalogType, dataset);
  }
  return latest;
}

function toVersionView(version: StoredEntryVersion): CatalogEntryVersionView {
  const rated = version.rateKind !== null && version.catalogType !== "tax";
  return {
    id: version.id,
    officialLabel: version.officialLabel,
    effectiveFrom: version.effectiveFrom,
    effectiveFromBasis: version.effectiveFromBasis,
    effectiveTo: version.effectiveTo,
    normativeStatus: version.normativeStatus,
    sourceRef: version.sourceRef,
    datasetVersion: version.datasetVersion,
    rate: rated
      ? {
          taxKind: version.taxKind!,
          sriTaxCode: version.sriTaxCode!,
          rateKind: version.rateKind!,
          percentage: version.percentage,
        }
      : null,
    taxKind: version.catalogType === "tax" ? version.taxKind : null,
    identificationRule:
      version.catalogType === "identification-type"
        ? {
            pattern: version.identificationPattern,
            description: version.identificationRule ?? "",
            reservedFor: version.reservedFor,
          }
        : null,
    withholding: version.scopeClassification
      ? {
          scopeClassification: version.scopeClassification,
          selectable: isSelectableScope(version.scopeClassification),
          percentage: version.rateKind === null ? version.percentage : null,
          rateText: version.rateText,
          allowedSupportCodes: version.allowedSupportCodes,
        }
      : null,
  };
}

/**
 * Agrupa las versiones por entrada, en el orden de sus códigos fiscales. La comparación numérica
 * ordena también los códigos literales de la renta (`303`, `303A`, `323 M`, `3250`).
 */
function groupEntries(versions: readonly StoredEntryVersion[]) {
  const groups = new Map<string, StoredEntryVersion[]>();
  for (const version of versions) {
    groups.set(version.entryKey, [...(groups.get(version.entryKey) ?? []), version]);
  }
  return [...groups.entries()].sort(
    ([keyA, [a]], [keyB, [b]]) =>
      a!.code.localeCompare(b!.code, "en", { numeric: true }) || keyA.localeCompare(keyB),
  );
}

function entryView(
  entryKey: string,
  versions: StoredEntryVersion[],
  at: IsoDate,
  decision: boolean | undefined,
  policy: EnablementPolicy,
): CatalogEntryView {
  const applicable = resolveCatalogEntry(versions, at);
  const enablement = effectiveEnablement({ decision, policy });
  return {
    entryKey,
    code: versions[0]!.code,
    versions: versions.map(toVersionView),
    applicable: applicable ? toVersionView(applicable) : null,
    enablement,
    usable: isUsable(applicable, enablement),
  };
}

export function createFiscalCatalogs({
  reader,
  enablement,
  uow,
  authorizer,
  now = () => new Date(),
}: FiscalCatalogsDependencies) {
  const today = () => ecuadorDate(now());

  async function policyOf(catalogType: FiscalCatalogType): Promise<{
    dataset: AppliedDataset;
    policy: EnablementPolicy;
  }> {
    const dataset = latestByType(await reader.catalogs()).get(catalogType);
    if (!dataset) throw catalogNotFound();
    return { dataset, policy: dataset.enablementPolicy };
  }

  return {
    /** Catálogos con la versión aplicada de su dataset, su fuente y su política. */
    async catalogs(ctx: RequestContext): Promise<FiscalCatalogSummaryView[]> {
      authorizer.requirePermission(ctx, "fiscalCatalogs.read");
      const latest = latestByType(await reader.catalogs());
      return FISCAL_CATALOG_TYPES.flatMap((catalogType) => {
        const dataset = latest.get(catalogType);
        return dataset
          ? [
              {
                catalogType,
                datasetVersion: dataset.version,
                source: source(dataset),
                enablementPolicy: dataset.enablementPolicy,
              },
            ]
          : [];
      });
    },

    /** Entradas con sus versiones, la aplicable en `at` y la habilitación de la empresa. */
    async entries(
      ctx: RequestContext,
      catalogType: string,
      query: unknown,
    ): Promise<CatalogEntriesView> {
      authorizer.requirePermission(ctx, "fiscalCatalogs.read");
      if (!isFiscalCatalogType(catalogType)) throw catalogNotFound();
      const { at = today(), enabled } = parseInput(catalogEntriesQuerySchema, query);
      const { dataset, policy } = await policyOf(catalogType);
      const decisions = isEnableable(catalogType)
        ? await enablement.decisions(ctx.companyId, catalogType)
        : new Map<string, boolean>();
      const entries = groupEntries(await reader.entryVersions(catalogType))
        .map(([entryKey, versions]) =>
          entryView(entryKey, versions, at, decisions.get(entryKey), policy),
        )
        .filter((entry) => enabled === undefined || String(entry.enablement.enabled) === enabled);
      return {
        catalog: {
          catalogType,
          datasetVersion: dataset.version,
          source: source(dataset),
          enablementPolicy: policy,
        },
        at,
        entries,
      };
    },

    /**
     * Habilitación como estado deseado (design D9): lock por empresa y entrada, decisión explícita
     * solo si cambia el estado efectivo, y auditoría solo de la transición real.
     */
    async setEnablement(
      ctx: RequestContext,
      catalogType: string,
      entryKey: string,
      body: unknown,
    ): Promise<CatalogEntryView> {
      authorizer.requirePermission(ctx, "fiscalCatalogs.manage");
      if (!isFiscalCatalogType(catalogType)) throw catalogNotFound();
      const { enabled } = parseInput(setEnablementSchema, body);
      if (!isEnableable(catalogType)) throw notEnableable();
      const date = today();
      return uow.run(async (scope) => {
        const versions = await scope.reader.entryVersions(catalogType, entryKey);
        if (versions.length === 0) throw entryNotFound();
        // Fuera de alcance (add-withholding-receipts, design D11): ninguna versión vigente o futura,
        // o ninguna si ya no las hay, está soportada; habilitarla o deshabilitarla no tendría efecto.
        const inForce = versions.filter((v) => v.effectiveTo === null || v.effectiveTo >= date);
        const candidates = inForce.length > 0 ? inForce : versions;
        if (!candidates.some((v) => isSelectableScope(v.scopeClassification))) {
          throw entryNotSelectable();
        }
        if (enabled && !hasCurrentOrFutureVersion(versions, date)) throw entryNotInForce();
        const { policy } = await policyOf(catalogType);
        await scope.enablement.lockEntry(ctx.companyId, catalogType, entryKey);
        const decision = await scope.enablement.decision(ctx.companyId, catalogType, entryKey);
        const current = effectiveEnablement({ decision, policy });
        if (current.enabled !== enabled) {
          await scope.enablement.saveDecision(
            ctx.companyId,
            catalogType,
            entryKey,
            enabled,
            ctx.userId,
          );
          await scope.audit.append({
            companyId: ctx.companyId,
            actor: { type: "USER", userId: ctx.userId },
            action: enabled ? "fiscal_catalog.entry_enabled" : "fiscal_catalog.entry_disabled",
            changes: {
              catalogType,
              entryKey,
              code: versions[0]!.code,
              "enabled.from": current.enabled,
              "enabled.to": enabled,
            },
            correlationId: ctx.requestId,
          });
        }
        const after = enabled === current.enabled ? decision : enabled;
        return entryView(entryKey, versions, date, after, policy);
      });
    },

    /** Versiones de la política de consumidor final y la aplicable en `at`. */
    async consumerFinalPolicy(
      ctx: RequestContext,
      query: unknown,
    ): Promise<ConsumerFinalPolicyView> {
      authorizer.requirePermission(ctx, "fiscalCatalogs.read");
      const { at = today() } = parseInput(catalogEntriesQuerySchema.pick({ at: true }), query);
      const dataset = latestByType(await reader.catalogs()).get("consumer-final-policy");
      if (!dataset) throw catalogNotFound();
      const versions = await reader.policyVersions();
      return {
        source: source(dataset),
        at,
        applicable: resolveCatalogEntry(versions, at),
        versions,
      };
    },

    async schemas(ctx: RequestContext): Promise<SchemaRegistryEntryView[]> {
      authorizer.requirePermission(ctx, "fiscalCatalogs.read");
      return (await reader.schemaEntries()).map((entry) => ({
        ...entry,
        downloadedAt: entry.downloadedAt.toISOString(),
      }));
    },

    async specialCases(ctx: RequestContext): Promise<SpecialCaseView[]> {
      authorizer.requirePermission(ctx, "fiscalCatalogs.read");
      return reader.specialCases();
    },
  };
}

export type FiscalCatalogs = ReturnType<typeof createFiscalCatalogs>;

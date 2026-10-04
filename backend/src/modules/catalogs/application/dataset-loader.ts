// Carga controlada de los datasets normativos al arrancar (add-fiscal-catalogs, design D3).
//  1. Todo se valida en memoria antes (validateDatasets): un dataset inválido no abre transacción.
//  2. Una sola transacción para todos los datasets pendientes, con el lock propio del cargador.
//  3. Lo aplicado se reconoce por versión, checksum y fuente; una diferencia es un fallo explícito.
//  4. Lo pendiente se aplica completo y en orden; nunca queda una carga parcial.
//  5. Una instancia que espera el lock reconoce lo que aplicó la ganadora y sigue.
//  6. Sin lock, los únicos hacen fallar la transacción concurrente: se reintenta una vez.
import { canonicalDecimal } from "@facturador/contracts";
import {
  canonicalJson,
  isEntriesDataset,
  type DatasetEntry,
  type SchemaRegistryDataset,
  type ValidatedDataset,
} from "../domain/datasets.ts";
import { isFiscalCatalogType } from "../domain/catalog-types.ts";
import type {
  DatasetStore,
  DatasetUnitOfWork,
  NewEntryVersion,
  StoredEntryVersion,
  StoredPolicyVersion,
  StoredSizePolicyVersion,
  StoredSchemaEntry,
} from "./ports.ts";

/** Fila del registro. La versión 1 no declaraba clase ni ruta: su ruta lógica es `sri-xsd/<archivo>`. */
function toStoredSchemaEntry(entry: SchemaRegistryDataset["entries"][number]): StoredSchemaEntry {
  const downloadedAt = new Date(entry.downloadedAt);
  if (!("kind" in entry)) {
    return {
      ...entry,
      kind: "DOCUMENT",
      path: `sri-xsd/${entry.file}`,
      revision: null,
      imports: [],
      downloadedAt,
    };
  }
  if (entry.kind === "DOCUMENT") return { ...entry, revision: null, downloadedAt };
  return { ...entry, documentType: null, version: null, root: null, imports: [], downloadedAt };
}

export class FiscalCatalogDatasetConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FiscalCatalogDatasetConflict";
  }
}

export type LoadReport = {
  applied: { catalogType: string; version: number; newEntries: number }[];
  alreadyApplied: { catalogType: string; version: number }[];
};

/** Error de unicidad de PostgreSQL o de Prisma: otra carga aplicó lo mismo a la vez. */
export const isUniqueViolation = (error: unknown): boolean => {
  const record = error as { code?: unknown; meta?: unknown; message?: unknown } | null;
  return (
    record?.code === "P2002" ||
    record?.code === "23505" ||
    (typeof record?.message === "string" && /unique constraint|23505/i.test(record.message))
  );
};

const versionId = (entryKey: string, effectiveFrom: string) => `${entryKey}@${effectiveFrom}`;

/** Lo que una versión publicada nunca cambia, comparable entre la base y el archivo. */
function immutable(entry: NewEntryVersion | StoredEntryVersion): string {
  const record = entry as Record<string, unknown>;
  const percentage = record.percentage;
  return canonicalJson({
    entryKey: record.entryKey,
    code: record.code,
    officialLabel: record.officialLabel,
    effectiveFrom: record.effectiveFrom,
    effectiveFromBasis: record.effectiveFromBasis,
    sourceRef: record.sourceRef,
    taxKind: record.taxKind ?? null,
    sriTaxCode: record.sriTaxCode ?? null,
    rateKind: record.rateKind ?? null,
    percentage: typeof percentage === "string" ? canonicalDecimal(percentage) : null,
    identificationPattern: record.identificationPattern ?? null,
    identificationRule: record.identificationRule ?? null,
    reservedFor: record.reservedFor ?? null,
  });
}

const SRI_TAX_CODES = { IVA: "2", ICE: "3", IRBPNR: "5" } as const;

function toNewVersion(dataset: ValidatedDataset, entry: DatasetEntry): NewEntryVersion {
  const record = entry as Record<string, unknown>;
  const catalogType = dataset.catalogType as NewEntryVersion["catalogType"];
  const taxKind =
    catalogType === "iva-rate"
      ? "IVA"
      : catalogType === "ice-rate"
        ? "ICE"
        : catalogType === "irbpnr-rate"
          ? "IRBPNR"
          : null;
  return {
    catalogType,
    entryKey: entry.entryKey,
    code: entry.code,
    officialLabel: entry.officialLabel,
    effectiveFrom: entry.effectiveFrom,
    effectiveFromBasis: entry.effectiveFromBasis,
    effectiveTo: entry.effectiveTo,
    normativeStatus: entry.normativeStatus,
    sourceRef: entry.sourceRef,
    datasetVersion: dataset.version,
    taxKind: catalogType === "tax" ? (record.taxKind as NewEntryVersion["taxKind"]) : taxKind,
    sriTaxCode: taxKind ? SRI_TAX_CODES[taxKind] : null,
    rateKind:
      catalogType === "iva-rate"
        ? (record.rateKind as NewEntryVersion["rateKind"])
        : catalogType === "ice-rate"
          ? "PER_NORMATIVE"
          : catalogType === "irbpnr-rate"
            ? "PER_UNIT"
            : null,
    percentage: (record.percentage as string | null | undefined) ?? null,
    identificationPattern: (record.identificationPattern as string | null | undefined) ?? null,
    identificationRule: (record.identificationRule as string | null | undefined) ?? null,
    reservedFor: (record.reservedFor as "CONSUMER_FINAL" | null | undefined) ?? null,
  };
}

async function applyEntries(store: DatasetStore, dataset: ValidatedDataset): Promise<number> {
  if (!isEntriesDataset(dataset) || !isFiscalCatalogType(dataset.catalogType)) return 0;
  const catalogType = dataset.catalogType;
  const label = `${catalogType} v${dataset.version}`;
  const existingKeys = new Map(
    (await store.keys(catalogType)).map((key) => [key.entryKey, key.code]),
  );
  const newKeys = new Map<string, string>();
  for (const entry of dataset.entries) {
    const code = existingKeys.get(entry.entryKey);
    if (code !== undefined && code !== entry.code) {
      throw new FiscalCatalogDatasetConflict(`${label}: ${entry.entryKey} cambia de código`);
    }
    if (code === undefined) newKeys.set(entry.entryKey, entry.code);
  }
  await store.insertKeys(
    catalogType,
    [...newKeys].map(([entryKey, code]) => ({ entryKey, code })),
  );

  const stored = new Map(
    (await store.entryVersions(catalogType)).map((version) => [
      versionId(version.entryKey, version.effectiveFrom),
      version,
    ]),
  );
  const fileIds = new Set(
    dataset.entries.map((entry) => versionId(entry.entryKey, entry.effectiveFrom)),
  );
  for (const id of stored.keys()) {
    if (!fileIds.has(id))
      throw new FiscalCatalogDatasetConflict(`${label}: falta la versión publicada ${id}`);
  }
  const inserts: NewEntryVersion[] = [];
  for (const entry of dataset.entries) {
    const id = versionId(entry.entryKey, entry.effectiveFrom);
    const current = stored.get(id);
    if (!current) {
      inserts.push(toNewVersion(dataset, entry));
      continue;
    }
    if (immutable(current) !== immutable(toNewVersion(dataset, entry))) {
      throw new FiscalCatalogDatasetConflict(`${label}: altera la versión publicada ${id}`);
    }
    if (current.effectiveTo !== entry.effectiveTo) {
      if (current.effectiveTo !== null) {
        throw new FiscalCatalogDatasetConflict(`${label}: cambia la vigencia cerrada de ${id}`);
      }
      await store.closeEntryVersion(current.id, entry.effectiveTo!, dataset.version);
    }
    if (current.normativeStatus !== entry.normativeStatus) {
      if (entry.normativeStatus !== "WITHDRAWN" || current.normativeStatus === "WITHDRAWN") {
        throw new FiscalCatalogDatasetConflict(`${label}: cambia el estado normativo de ${id}`);
      }
      await store.withdrawEntryVersion(current.id, dataset.version);
    }
  }
  // Las versiones nuevas se insertan después de cerrar las anteriores, así nunca se superponen.
  await store.insertEntryVersions(inserts);
  return inserts.length;
}

async function applyPolicy(store: DatasetStore, dataset: ValidatedDataset): Promise<number> {
  if (dataset.catalogType !== "consumer-final-policy") return 0;
  const label = `${dataset.catalogType} v${dataset.version}`;
  const stored = new Map(
    (await store.policyVersions()).map((version) => [version.effectiveFrom, version]),
  );
  const fileStarts = new Set(dataset.versions.map((version) => version.effectiveFrom));
  for (const start of stored.keys()) {
    if (!fileStarts.has(start))
      throw new FiscalCatalogDatasetConflict(`${label}: falta la versión ${start}`);
  }
  const comparable = (version: Omit<StoredPolicyVersion, "id" | "datasetVersion">) =>
    canonicalJson({
      maxAmount: canonicalDecimal(version.maxAmount),
      currency: version.currency,
      identificationType: version.identificationType,
      identification: version.identification,
      canonicalName: version.canonicalName,
      effectiveFrom: version.effectiveFrom,
      effectiveFromBasis: version.effectiveFromBasis,
      sourceRef: version.sourceRef,
    });
  const inserts = [];
  for (const version of dataset.versions) {
    const current = stored.get(version.effectiveFrom);
    if (!current) {
      inserts.push({ ...version, datasetVersion: dataset.version });
      continue;
    }
    if (comparable(current) !== comparable(version)) {
      throw new FiscalCatalogDatasetConflict(
        `${label}: altera la versión ${version.effectiveFrom}`,
      );
    }
    if (current.effectiveTo !== version.effectiveTo) {
      if (current.effectiveTo !== null) {
        throw new FiscalCatalogDatasetConflict(
          `${label}: reabre la versión ${version.effectiveFrom}`,
        );
      }
      await store.closePolicyVersion(current.id, version.effectiveTo!, dataset.version);
    }
  }
  await store.insertPolicyVersions(inserts);
  return inserts.length;
}

/** Política de tamaño del envío al SRI: mismas reglas que la de consumidor final (design D17). */
async function applySizePolicy(store: DatasetStore, dataset: ValidatedDataset): Promise<number> {
  if (dataset.catalogType !== "sri-transmission-policy") return 0;
  const label = `${dataset.catalogType} v${dataset.version}`;
  const stored = new Map(
    (await store.sizePolicyVersions()).map((version) => [version.effectiveFrom, version]),
  );
  const fileStarts = new Set(dataset.versions.map((version) => version.effectiveFrom));
  for (const start of stored.keys()) {
    if (!fileStarts.has(start))
      throw new FiscalCatalogDatasetConflict(`${label}: falta la versión ${start}`);
  }
  const comparable = (version: Omit<StoredSizePolicyVersion, "id" | "datasetVersion">) =>
    canonicalJson({
      maxSignedDocumentBytes: version.maxSignedDocumentBytes,
      sourceText: version.sourceText,
      sourceSection: version.sourceSection,
      literalUnit: version.literalUnit,
      interpretation: version.interpretation,
      effectiveFrom: version.effectiveFrom,
      effectiveFromBasis: version.effectiveFromBasis,
    });
  const inserts = [];
  for (const version of dataset.versions) {
    const current = stored.get(version.effectiveFrom);
    if (!current) {
      inserts.push({ ...version, datasetVersion: dataset.version });
      continue;
    }
    if (comparable(current) !== comparable(version)) {
      throw new FiscalCatalogDatasetConflict(
        `${label}: altera la versión ${version.effectiveFrom}`,
      );
    }
    if (current.effectiveTo !== version.effectiveTo) {
      if (current.effectiveTo !== null) {
        throw new FiscalCatalogDatasetConflict(
          `${label}: reabre la versión ${version.effectiveFrom}`,
        );
      }
      await store.closeSizePolicyVersion(current.id, version.effectiveTo!, dataset.version);
    }
  }
  await store.insertSizePolicyVersions(inserts);
  return inserts.length;
}

async function applyDataset(store: DatasetStore, dataset: ValidatedDataset): Promise<number> {
  await store.insertDataset({
    catalogType: dataset.catalogType,
    version: dataset.version,
    checksum: dataset.checksum,
    sourceDocument: dataset.source.document,
    sourceVersion: dataset.source.version,
    sourcePublishedOn: dataset.source.publishedOn,
    sourceUrl: dataset.source.url,
    sourceSha256: dataset.source.sha256,
    enablementPolicy: dataset.enablementPolicy,
  });
  if (dataset.catalogType === "schema-registry") {
    await store.insertSchemaEntries(dataset.version, dataset.entries.map(toStoredSchemaEntry));
    return dataset.entries.length;
  }
  if (dataset.catalogType === "special-case-matrix") {
    await store.insertSpecialCases(dataset.version, dataset.entries);
    return dataset.entries.length;
  }
  if (dataset.catalogType === "sri-transmission-policy") return applySizePolicy(store, dataset);
  return dataset.catalogType === "consumer-final-policy"
    ? applyPolicy(store, dataset)
    : applyEntries(store, dataset);
}

async function loadOnce(
  uow: DatasetUnitOfWork,
  datasets: readonly ValidatedDataset[],
): Promise<LoadReport> {
  return uow.run(async (store) => {
    await store.lockLoader();
    const applied = new Map(
      (await store.appliedDatasets()).map((row) => [`${row.catalogType}@${row.version}`, row]),
    );
    const report: LoadReport = { applied: [], alreadyApplied: [] };
    const ordered = [...datasets].sort(
      (a, b) => a.catalogType.localeCompare(b.catalogType) || a.version - b.version,
    );
    for (const dataset of ordered) {
      const row = applied.get(`${dataset.catalogType}@${dataset.version}`);
      if (row) {
        if (
          row.checksum !== dataset.checksum ||
          row.sourceSha256 !== dataset.source.sha256 ||
          row.sourceVersion !== dataset.source.version
        ) {
          throw new FiscalCatalogDatasetConflict(
            `${dataset.catalogType} v${dataset.version}: ya aplicado con otro contenido o con otra fuente`,
          );
        }
        report.alreadyApplied.push({ catalogType: dataset.catalogType, version: dataset.version });
        continue;
      }
      const previous =
        dataset.version === 1 ||
        applied.has(`${dataset.catalogType}@${dataset.version - 1}`) ||
        report.applied.some(
          (a) => a.catalogType === dataset.catalogType && a.version === dataset.version - 1,
        );
      if (!previous) {
        throw new FiscalCatalogDatasetConflict(
          `${dataset.catalogType} v${dataset.version}: falta aplicar la versión anterior`,
        );
      }
      const newEntries = await applyDataset(store, dataset);
      report.applied.push({
        catalogType: dataset.catalogType,
        version: dataset.version,
        newEntries,
      });
    }
    return report;
  });
}

/**
 * Aplica los datasets pendientes de forma atómica. Seguro con varias instancias a la vez: el lock
 * serializa, y si un despliegue lo alterara, los únicos hacen fallar a la perdedora, que reintenta.
 */
export async function loadFiscalCatalogs({
  uow,
  datasets,
}: {
  uow: DatasetUnitOfWork;
  datasets: readonly ValidatedDataset[];
}): Promise<LoadReport> {
  try {
    return await loadOnce(uow, datasets);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return loadOnce(uow, datasets);
  }
}

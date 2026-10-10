// Repositorios Prisma de los catálogos fiscales (add-fiscal-catalogs, design D3, D5 y D9). Solo este
// módulo lee y escribe las tablas de catálogos.
import type { FiscalCatalogType } from "@facturador/contracts";
import { FiscalDecimal } from "../../../platform/decimal/fiscal-decimal.ts";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts";
import type {
  AppliedDataset,
  CatalogReader,
  DatasetStore,
  EnablementRepository,
  NewEntryVersion,
  NewPolicyVersion,
  StoredEntryVersion,
  StoredPolicyVersion,
  StoredSchemaEntry,
  StoredSpecialCase,
} from "../application/ports.ts";

type Db = PrismaClient | Prisma.TransactionClient;

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const toIso = (date: Date) => date.toISOString().slice(0, 10);
const toIsoOrNull = (date: Date | null) => (date ? toIso(date) : null);

type EntryRow = Awaited<ReturnType<PrismaClient["fiscalCatalogEntry"]["findMany"]>>[number] & {
  key: { code: string };
};

function toStoredEntry(row: EntryRow): StoredEntryVersion {
  return {
    id: row.id,
    catalogType: row.catalogType as FiscalCatalogType,
    entryKey: row.entryKey,
    code: row.key.code,
    officialLabel: row.officialLabel,
    effectiveFrom: toIso(row.effectiveFrom),
    effectiveFromBasis: row.effectiveFromBasis as StoredEntryVersion["effectiveFromBasis"],
    effectiveTo: toIsoOrNull(row.effectiveTo),
    normativeStatus: row.normativeStatus as StoredEntryVersion["normativeStatus"],
    sourceRef: row.sourceRef,
    datasetVersion: row.datasetVersion,
    taxKind: row.taxKind as StoredEntryVersion["taxKind"],
    sriTaxCode: row.sriTaxCode,
    rateKind: row.rateKind as StoredEntryVersion["rateKind"],
    percentage: row.percentage
      ? FiscalDecimal.fromDatabase("tarifa", row.percentage).toString()
      : null,
    identificationPattern: row.identificationPattern,
    identificationRule: row.identificationRule,
    reservedFor: row.reservedFor as StoredEntryVersion["reservedFor"],
    scopeClassification: row.scopeClassification as StoredEntryVersion["scopeClassification"],
    rateText: row.rateText,
    // Una lista de PostgreSQL sin valor llega vacía o nula: solo los tipos de documento la tienen.
    allowedSupportCodes:
      row.catalogType === "support-document-type" ? (row.allowedSupportCodes ?? []) : null,
  };
}

function toStoredPolicy(
  row: Awaited<ReturnType<PrismaClient["consumerFinalPolicy"]["findMany"]>>[number],
): StoredPolicyVersion {
  return {
    id: row.id,
    maxAmount: FiscalDecimal.fromDatabase("importe", row.maxAmount).toString(),
    currency: "USD",
    identificationType: row.identificationType,
    identification: row.identification,
    canonicalName: row.canonicalName,
    effectiveFrom: toIso(row.effectiveFrom),
    effectiveFromBasis: row.effectiveFromBasis as StoredPolicyVersion["effectiveFromBasis"],
    effectiveTo: toIsoOrNull(row.effectiveTo),
    sourceRef: row.sourceRef,
    datasetVersion: row.datasetVersion,
  };
}

const ENTRY_ORDER = [{ entryKey: "asc" as const }, { effectiveFrom: "asc" as const }];

function readEntries(db: Db, catalogType: FiscalCatalogType, entryKey?: string) {
  return db.fiscalCatalogEntry
    .findMany({
      where: { catalogType, ...(entryKey ? { entryKey } : {}) },
      include: { key: { select: { code: true } } },
      orderBy: ENTRY_ORDER,
    })
    .then((rows) => rows.map(toStoredEntry));
}

async function readApplied(db: Db): Promise<AppliedDataset[]> {
  const rows = await db.fiscalCatalogDataset.findMany({
    orderBy: [{ catalogType: "asc" }, { version: "asc" }],
  });
  return rows.map((row) => ({
    catalogType: row.catalogType,
    version: row.version,
    checksum: row.checksum,
    sourceDocument: row.sourceDocument,
    sourceVersion: row.sourceVersion,
    sourcePublishedOn: toIso(row.sourcePublishedOn),
    sourceUrl: row.sourceUrl,
    sourceSha256: row.sourceSha256,
    enablementPolicy: row.enablementPolicy as AppliedDataset["enablementPolicy"],
  }));
}

/** Última versión aplicada de cada dataset que se guarda por versión (registro y matriz). */
async function latestVersion(db: Db, catalogType: string): Promise<number | null> {
  const row = await db.fiscalCatalogDataset.findFirst({
    where: { catalogType },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return row?.version ?? null;
}

export function createCatalogReader(db: Db): CatalogReader {
  return {
    catalogs: () => readApplied(db),
    entryVersions: (catalogType, entryKey) => readEntries(db, catalogType, entryKey),
    async policyVersions() {
      const rows = await db.consumerFinalPolicy.findMany({ orderBy: { effectiveFrom: "asc" } });
      return rows.map(toStoredPolicy);
    },
    async schemaEntries(): Promise<StoredSchemaEntry[]> {
      const version = await latestVersion(db, "schema-registry");
      if (version === null) return [];
      const rows = await db.schemaRegistryEntry.findMany({
        where: { datasetVersion: version },
        orderBy: [{ kind: "asc" }, { documentType: "asc" }, { version: "asc" }, { path: "asc" }],
      });
      return rows.map(({ datasetVersion: _v, ...row }) => ({
        ...row,
        kind: row.kind as StoredSchemaEntry["kind"],
      }));
    },
    async specialCases(): Promise<StoredSpecialCase[]> {
      const version = await latestVersion(db, "special-case-matrix");
      if (version === null) return [];
      const rows = await db.specialCaseSupport.findMany({
        where: { datasetVersion: version },
        orderBy: { annex: "asc" },
      });
      return rows.map(({ datasetVersion: _v, ...row }) => ({
        ...row,
        category: row.category as StoredSpecialCase["category"],
      }));
    },
  };
}

const toEntryRow = (version: NewEntryVersion) => ({
  catalogType: version.catalogType,
  entryKey: version.entryKey,
  officialLabel: version.officialLabel,
  effectiveFrom: toDate(version.effectiveFrom),
  effectiveFromBasis: version.effectiveFromBasis,
  effectiveTo: version.effectiveTo ? toDate(version.effectiveTo) : null,
  normativeStatus: version.normativeStatus,
  sourceRef: version.sourceRef,
  datasetVersion: version.datasetVersion,
  taxKind: version.taxKind,
  sriTaxCode: version.sriTaxCode,
  rateKind: version.rateKind,
  percentage: version.percentage
    ? FiscalDecimal.parse("tarifa", version.percentage).toDatabase()
    : null,
  identificationPattern: version.identificationPattern,
  identificationRule: version.identificationRule,
  reservedFor: version.reservedFor,
  scopeClassification: version.scopeClassification,
  rateText: version.rateText,
  allowedSupportCodes: version.allowedSupportCodes ?? undefined,
});

const toPolicyRow = (version: NewPolicyVersion) => ({
  maxAmount: FiscalDecimal.parse("importe", version.maxAmount).toDatabase(),
  currency: version.currency,
  identificationType: version.identificationType,
  identification: version.identification,
  canonicalName: version.canonicalName,
  effectiveFrom: toDate(version.effectiveFrom),
  effectiveFromBasis: version.effectiveFromBasis,
  effectiveTo: version.effectiveTo ? toDate(version.effectiveTo) : null,
  sourceRef: version.sourceRef,
  datasetVersion: version.datasetVersion,
});

/** Lock propio del cargador: distinto del de las migraciones de Prisma (design D3). */
export const LOADER_LOCK = "fiscal-catalogs:loader";

export function createDatasetStore(tx: Prisma.TransactionClient): DatasetStore {
  return {
    async lockLoader() {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOADER_LOCK}))`;
    },
    appliedDatasets: () => readApplied(tx),
    async insertDataset(dataset) {
      await tx.fiscalCatalogDataset.create({
        data: {
          catalogType: dataset.catalogType,
          version: dataset.version,
          sourceDocument: dataset.sourceDocument,
          sourceVersion: dataset.sourceVersion,
          sourcePublishedOn: toDate(dataset.sourcePublishedOn),
          sourceUrl: dataset.sourceUrl,
          sourceSha256: dataset.sourceSha256,
          enablementPolicy: dataset.enablementPolicy,
          checksum: dataset.checksum,
        },
      });
    },
    entryVersions: (catalogType) => readEntries(tx, catalogType),
    keys: (catalogType) =>
      tx.fiscalCatalogKey.findMany({
        where: { catalogType },
        select: { entryKey: true, code: true },
      }),
    async insertKeys(catalogType, keys) {
      if (keys.length === 0) return;
      await tx.fiscalCatalogKey.createMany({ data: keys.map((key) => ({ catalogType, ...key })) });
    },
    async insertEntryVersions(versions) {
      if (versions.length === 0) return;
      await tx.fiscalCatalogEntry.createMany({ data: versions.map(toEntryRow) });
    },
    async closeEntryVersion(id, effectiveTo, datasetVersion) {
      await tx.fiscalCatalogEntry.update({
        where: { id },
        data: { effectiveTo: toDate(effectiveTo), closedInDatasetVersion: datasetVersion },
      });
    },
    async withdrawEntryVersion(id, datasetVersion) {
      await tx.fiscalCatalogEntry.update({
        where: { id },
        data: { normativeStatus: "WITHDRAWN", statusChangedInDatasetVersion: datasetVersion },
      });
    },
    async policyVersions() {
      const rows = await tx.consumerFinalPolicy.findMany({ orderBy: { effectiveFrom: "asc" } });
      return rows.map(toStoredPolicy);
    },
    async insertPolicyVersions(versions) {
      if (versions.length === 0) return;
      await tx.consumerFinalPolicy.createMany({ data: versions.map(toPolicyRow) });
    },
    async closePolicyVersion(id, effectiveTo, datasetVersion) {
      await tx.consumerFinalPolicy.update({
        where: { id },
        data: { effectiveTo: toDate(effectiveTo), closedInDatasetVersion: datasetVersion },
      });
    },
    async insertSchemaEntries(datasetVersion, entries) {
      await tx.schemaRegistryEntry.createMany({
        data: entries.map((entry) => ({ ...entry, datasetVersion })),
      });
    },
    async insertSpecialCases(datasetVersion, entries) {
      await tx.specialCaseSupport.createMany({
        data: entries.map((entry) => ({ ...entry, datasetVersion })),
      });
    },
  };
}

export function createEnablementRepository(db: Db): EnablementRepository {
  return {
    async decisions(companyId, catalogType) {
      const rows = await db.companyFiscalCatalogSetting.findMany({
        where: { companyId, catalogType },
        select: { entryKey: true, enabled: true },
      });
      return new Map(rows.map((row) => [row.entryKey, row.enabled]));
    },
    async lockEntry(companyId, catalogType, entryKey) {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fiscal-catalog-enablement:${companyId}:${catalogType}:${entryKey}`}))`;
    },
    async decision(companyId, catalogType, entryKey) {
      const row = await db.companyFiscalCatalogSetting.findUnique({
        where: { companyId_catalogType_entryKey: { companyId, catalogType, entryKey } },
        select: { enabled: true },
      });
      return row?.enabled;
    },
    async saveDecision(companyId, catalogType, entryKey, enabled, userId) {
      await db.companyFiscalCatalogSetting.upsert({
        where: { companyId_catalogType_entryKey: { companyId, catalogType, entryKey } },
        create: { companyId, catalogType, entryKey, enabled, updatedBy: userId },
        update: { enabled, updatedBy: userId },
      });
    },
  };
}

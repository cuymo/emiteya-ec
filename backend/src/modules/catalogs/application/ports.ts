// Puertos del módulo de catálogos fiscales (add-fiscal-catalogs, design D1, D3, D5 y D9).
import type {
  EffectiveFromBasis,
  EnablementPolicy,
  FiscalCatalogType,
  NormativeStatus,
  RateKind,
  SpecialCaseCategory,
  TaxKind,
} from "@facturador/contracts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { IsoDate } from "../domain/validity.ts";

/** Versión guardada de una entrada; `percentage` en forma canónica de `DecimalString`. */
export type StoredEntryVersion = {
  id: string;
  catalogType: FiscalCatalogType;
  entryKey: string;
  code: string;
  officialLabel: string;
  effectiveFrom: IsoDate;
  effectiveFromBasis: EffectiveFromBasis;
  effectiveTo: IsoDate | null;
  normativeStatus: NormativeStatus;
  sourceRef: string;
  datasetVersion: number;
  taxKind: TaxKind | null;
  sriTaxCode: string | null;
  rateKind: RateKind | null;
  percentage: string | null;
  identificationPattern: string | null;
  identificationRule: string | null;
  reservedFor: "CONSUMER_FINAL" | null;
};

export type AppliedDataset = {
  catalogType: string;
  version: number;
  checksum: string;
  sourceVersion: string;
  sourceSha256: string;
  enablementPolicy: EnablementPolicy;
  sourceDocument: string;
  sourcePublishedOn: IsoDate;
  sourceUrl: string;
};

export type StoredPolicyVersion = {
  id: string;
  maxAmount: string;
  currency: "USD";
  identificationType: string;
  identification: string;
  canonicalName: string;
  effectiveFrom: IsoDate;
  effectiveFromBasis: EffectiveFromBasis;
  effectiveTo: IsoDate | null;
  sourceRef: string;
  datasetVersion: number;
};

export type StoredSchemaEntry = {
  documentType: string;
  version: string;
  root: string;
  file: string;
  sha256: string;
  source: string;
  downloadedAt: Date;
  supported: boolean;
};

export type StoredSpecialCase = {
  annex: number;
  topic: string;
  category: SpecialCaseCategory;
  sourceRef: string;
};

export type NewEntryVersion = Omit<StoredEntryVersion, "id">;
export type NewPolicyVersion = Omit<StoredPolicyVersion, "id">;

/** Operaciones del cargador, dentro de su transacción (design D3). */
export interface DatasetStore {
  /** Lock propio del cargador, distinto del de las migraciones; se libera al terminar. */
  lockLoader(): Promise<void>;
  appliedDatasets(): Promise<AppliedDataset[]>;
  insertDataset(
    dataset: Omit<AppliedDataset, "sourceDocument"> & { sourceDocument: string },
  ): Promise<void>;
  entryVersions(catalogType: FiscalCatalogType): Promise<StoredEntryVersion[]>;
  keys(catalogType: FiscalCatalogType): Promise<{ entryKey: string; code: string }[]>;
  insertKeys(
    catalogType: FiscalCatalogType,
    keys: { entryKey: string; code: string }[],
  ): Promise<void>;
  insertEntryVersions(versions: NewEntryVersion[]): Promise<void>;
  closeEntryVersion(id: string, effectiveTo: IsoDate, datasetVersion: number): Promise<void>;
  withdrawEntryVersion(id: string, datasetVersion: number): Promise<void>;
  policyVersions(): Promise<StoredPolicyVersion[]>;
  insertPolicyVersions(versions: NewPolicyVersion[]): Promise<void>;
  closePolicyVersion(id: string, effectiveTo: IsoDate, datasetVersion: number): Promise<void>;
  insertSchemaEntries(datasetVersion: number, entries: StoredSchemaEntry[]): Promise<void>;
  insertSpecialCases(datasetVersion: number, entries: StoredSpecialCase[]): Promise<void>;
}

export interface DatasetUnitOfWork {
  run<T>(work: (store: DatasetStore) => Promise<T>): Promise<T>;
}

/** Lecturas de los catálogos del sistema. Solo `catalogs` lee estas tablas (design D5). */
export interface CatalogReader {
  catalogs(): Promise<AppliedDataset[]>;
  entryVersions(catalogType: FiscalCatalogType, entryKey?: string): Promise<StoredEntryVersion[]>;
  policyVersions(): Promise<StoredPolicyVersion[]>;
  schemaEntries(): Promise<StoredSchemaEntry[]>;
  specialCases(): Promise<StoredSpecialCase[]>;
}

/** Decisiones de habilitación de una empresa (design D9). */
export interface EnablementRepository {
  decisions(companyId: string, catalogType: FiscalCatalogType): Promise<Map<string, boolean>>;
  /** Crea la fila con el valor por defecto si no existe y la bloquea; devuelve la decisión previa. */
  lockDecision(
    companyId: string,
    catalogType: FiscalCatalogType,
    entryKey: string,
    defaultEnabled: boolean,
    userId: string,
  ): Promise<{ enabled: boolean; existed: boolean }>;
  saveDecision(
    companyId: string,
    catalogType: FiscalCatalogType,
    entryKey: string,
    enabled: boolean,
    userId: string,
  ): Promise<void>;
}

export interface CatalogsUnitOfWork {
  run<T>(
    work: (scope: {
      enablement: EnablementRepository;
      reader: CatalogReader;
      audit: AuditLog;
    }) => Promise<T>,
  ): Promise<T>;
}

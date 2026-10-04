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

/** Versión de la política de tamaño del envío al SRI (add-sri-transmission, design D17). */
export type StoredSizePolicyVersion = {
  id: string;
  maxSignedDocumentBytes: number;
  sourceText: string;
  sourceSection: string;
  literalUnit: string;
  interpretation: string;
  effectiveFrom: IsoDate;
  effectiveFromBasis: EffectiveFromBasis;
  effectiveTo: IsoDate | null;
  datasetVersion: number;
};

/** Archivo del registro de esquemas: un esquema de documento o uno que este importa. */
export type StoredSchemaEntry = {
  kind: "DOCUMENT" | "IMPORT";
  path: string;
  documentType: string | null;
  version: string | null;
  root: string | null;
  file: string;
  sha256: string;
  source: string;
  revision: string | null;
  imports: string[];
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
export type NewSizePolicyVersion = Omit<StoredSizePolicyVersion, "id">;

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
  sizePolicyVersions(): Promise<StoredSizePolicyVersion[]>;
  insertSizePolicyVersions(versions: NewSizePolicyVersion[]): Promise<void>;
  closeSizePolicyVersion(id: string, effectiveTo: IsoDate, datasetVersion: number): Promise<void>;
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
  sizePolicyVersions(): Promise<StoredSizePolicyVersion[]>;
  schemaEntries(): Promise<StoredSchemaEntry[]>;
  specialCases(): Promise<StoredSpecialCase[]>;
}

/** Decisiones de habilitación de una empresa (design D9). Una fila es una decisión explícita. */
export interface EnablementRepository {
  decisions(companyId: string, catalogType: FiscalCatalogType): Promise<Map<string, boolean>>;
  /** Serializa los cambios de una misma entrada de una empresa hasta el fin de la transacción. */
  lockEntry(companyId: string, catalogType: FiscalCatalogType, entryKey: string): Promise<void>;
  decision(
    companyId: string,
    catalogType: FiscalCatalogType,
    entryKey: string,
  ): Promise<boolean | undefined>;
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

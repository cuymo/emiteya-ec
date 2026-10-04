// Puertos del módulo invoices (add-invoice-emission, design D1 y D2). La infraestructura los
// implementa con Prisma y con las lecturas internas de los otros módulos; los casos de uso nunca
// importan infraestructura ajena.
import type { DbClient } from "../../../platform/db/database.ts";
import type { ListMeta } from "@facturador/contracts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type {
  ArtifactStore,
  DocumentRepository,
  StoredDocument,
} from "../../fiscal/application/ports.ts";
import type { IdempotencyStore } from "../../../platform/idempotency/idempotency.ts";
import type { SchemaRegistryEntry } from "../../sri-engine/application/schemas.ts";
import type { DraftContent, DraftRecord } from "../domain/draft.ts";
import type {
  AvailabilityLike,
  EvaluationBuyer,
  EvaluationPoint,
  EvaluationPolicy,
  EvaluationProduct,
  IssuerProfile,
} from "../domain/evaluation.ts";

export interface DraftRepository {
  create(companyId: string, content: DraftContent, userId: string): Promise<DraftRecord>;
  find(companyId: string, draftId: string): Promise<DraftRecord | null>;
  /** Borradores `DRAFT` por última actualización, del más reciente al más antiguo. */
  list(
    companyId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: DraftRecord[]; total: number }>;
  /** Reemplaza el contenido solo si sigue `DRAFT` con esa versión; true si lo cambió. */
  updateIfVersion(
    companyId: string,
    draftId: string,
    expectedVersion: number,
    content: DraftContent,
    userId: string,
  ): Promise<boolean>;
  /** Elimina el borrador solo si sigue `DRAFT`; true si lo eliminó. */
  deleteIfDraft(companyId: string, draftId: string): Promise<boolean>;
}

export type DraftsScope = { drafts: DraftRepository };

/** Escrituras de borradores en una transacción: el borrador, sus líneas y sus pagos juntos. */
export interface DraftsUnitOfWork {
  run<T>(work: (scope: DraftsScope) => Promise<T>): Promise<T>;
}

/** Configuración tributaria vigente tal como la lee la emisión. */
export type EmissionConfig = Readonly<{
  versionId: string;
  version: number;
  config: Readonly<{ profile: IssuerProfile; environment: "TEST" | "PRODUCTION" }>;
  taxIdentityLocked: boolean;
}>;

export type ActiveCertificateRead = Readonly<{ id: string; fingerprint: string; usable: boolean }>;

/**
 * Lecturas de la evaluación de una factura (design D1 y D6). La vista previa las hace sobre la
 * conexión; la emisión, dentro de su transacción de reserva, con lecturas coherentes.
 */
/**
 * Inventario de los productos sobre un cliente (add-minimal-inventory, design D1 y D4): el saldo de
 * los que tienen inventario inicializado. Lo implementa `inventory` y lo inyecta `main.ts`; invoices
 * no importa inventory.
 */
export type StockReads = (db: DbClient) => {
  balances(companyId: string, productIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
};

export type EvaluationReads = {
  currentConfig(companyId: string): Promise<EmissionConfig | null>;
  emissionPoint(companyId: string, emissionPointId: string): Promise<EvaluationPoint | null>;
  activeCertificate(companyId: string): Promise<ActiveCertificateRead | null>;
  party(companyId: string, partyId: string): Promise<EvaluationBuyer | null>;
  product(companyId: string, productId: string): Promise<EvaluationProduct | null>;
  /** Saldo de los productos con inventario inicializado; los demás no aparecen. */
  stock(companyId: string, productIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  catalogs: CatalogReads;
};

export type CatalogReads = {
  availability(
    companyId: string,
    catalogType: string,
    date: string,
  ): Promise<ReadonlyMap<string, AvailabilityLike>>;
  /** La regla vigente del tipo de identificación en la fecha, o null. */
  identificationRule(code: string, date: string): Promise<unknown>;
  consumerFinalPolicy(date: string): Promise<EvaluationPolicy | null>;
  specialCases(): Promise<readonly Readonly<{ annex: number; topic: string; category: string }>[]>;
  schemaRegistry(): Promise<readonly SchemaRegistryEntry[]>;
  /** Última versión aplicada de cada catálogo. */
  datasetVersions(): Promise<Readonly<Record<string, number>>>;
};

export type Page<T> = { items: T[]; meta: ListMeta };

export type SequentialReservation = Readonly<{
  reservationId: string;
  sequential: number;
  documentNumber: string;
}>;

/**
 * Operaciones de la transacción de `RESERVED` (design D7), todas sobre la misma transacción: sin
 * I/O externo ni XML.
 */
export type EmissionScope = {
  /** `SELECT … FOR UPDATE` del borrador de la empresa: serializa sus emisiones. */
  lockDraft(companyId: string, draftId: string): Promise<DraftRecord | null>;
  markDraftEmitted(
    companyId: string,
    draftId: string,
    documentId: string,
    userId: string,
  ): Promise<void>;
  /** Lock advisory de la configuración de la empresa. */
  lockConfiguration(companyId: string): Promise<void>;
  reads: EvaluationReads;
  reserveSequential(input: {
    companyId: string;
    environment: "TEST" | "PRODUCTION";
    establishmentId: string;
    emissionPointId: string;
    documentType: "01";
    reservedBy: string;
    correlationId: string;
  }): Promise<SequentialReservation>;
  /** Bloquea la identidad tributaria; idempotente. */
  lockTaxIdentity(companyId: string): Promise<boolean>;
  documents: DocumentRepository;
  idempotency: IdempotencyStore;
  audit: AuditLog;
};

export interface EmissionUnitOfWork {
  run<T>(work: (scope: EmissionScope) => Promise<T>): Promise<T>;
}

/** Persistencia del artefacto y del paso a `SIGNED` en una transacción (design D9, paso 6). */
export type SignedScope = {
  artifacts: ArtifactStore;
  documents: DocumentRepository;
  audit: AuditLog;
  /**
   * Encola el `sri.transmit` inicial en la misma transacción que firma (add-sri-transmission,
   * design D6): nunca hay un comprobante firmado sin su job.
   */
  enqueueTransmission(document: Pick<StoredDocument, "id" | "companyId">): Promise<boolean>;
};

export interface SignedUnitOfWork {
  run<T>(work: (scope: SignedScope) => Promise<T>): Promise<T>;
}

// Puertos de la numeración fiscal (add-fiscal-numbering, design D1 a D4). La infraestructura los
// implementa con Prisma; los casos de uso solo ven datos del dominio.
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { EstablishmentRepository } from "../../taxpayer/application/ports.ts";
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import type { CounterState, DocumentType } from "../domain/numbering.ts";
import type {
  ArtifactKind,
  AttemptDiagnostic,
  DocumentState,
  TransitionActor,
} from "../domain/document.ts";

/** Clave del contador: empresa, ambiente, establecimiento, punto y tipo (ADR 0003). */
export type SequenceKey = Readonly<{
  companyId: string;
  environment: Environment;
  establishmentId: string;
  emissionPointId: string;
  documentType: DocumentType;
}>;

export type StoredCounter = CounterState & Readonly<{ key: SequenceKey }>;

export interface SequenceRepository {
  /** Crea el contador en 1 si no existe: INSERT ... ON CONFLICT DO NOTHING (design D3). */
  ensure(key: SequenceKey): Promise<void>;
  find(key: SequenceKey): Promise<CounterState | null>;
  listForCompany(companyId: string, environment: Environment): Promise<StoredCounter[]>;
  /** Avanza el contador bloqueando su fila; el número reservado, o null si está agotado. */
  increment(key: SequenceKey): Promise<number | null>;
  setLastReserved(key: SequenceKey, sequential: number): Promise<void>;
  record(input: {
    key: SequenceKey;
    sequential: number;
    reservedBy: string | null;
    correlationId: string;
  }): Promise<{ id: string }>;
  /** Fija el siguiente solo si sigue en `expected` y supera al último reservado (design D9). */
  adjust(key: SequenceKey, expected: number, next: number): Promise<boolean>;
}

export type FiscalScope = {
  sequences: SequenceRepository;
  points: Pick<EstablishmentRepository, "findPointWithEstablishment" | "list">;
  audit: AuditLog;
};

/** Transacción de la numeración: solo operaciones de base de datos, sin I/O externo (design D5). */
export interface FiscalUnitOfWork {
  run<T>(work: (scope: FiscalScope) => Promise<T>): Promise<T>;
}

/** Comprobante electrónico tal como se guarda (add-invoice-emission, design D3). */
export type StoredDocument = Readonly<{
  id: string;
  companyId: string;
  documentType: DocumentType;
  environment: Environment;
  establishmentId: string;
  emissionPointId: string;
  documentNumber: string;
  sequential: number;
  reservationId: string;
  accessKey: string;
  numericCode: string;
  /** `YYYY-MM-DD`. */
  issueDate: string;
  state: DocumentState;
  /** Snapshot versionado: lo interpreta el módulo del tipo de comprobante. */
  snapshot: unknown;
  schemaVersion: string;
  buyerIdentification: string;
  buyerName: string;
  total: string;
  createdAt: Date;
  createdBy: string;
  signedAt: Date | null;
  lastAttempt: AttemptDiagnostic | null;
  attemptCount: number;
  attemptLeaseUntil: Date | null;
}>;

export type NewReservedDocument = Omit<
  StoredDocument,
  "id" | "state" | "createdAt" | "signedAt" | "lastAttempt" | "attemptCount" | "attemptLeaseUntil"
>;

export type DocumentListQuery = Readonly<{
  documentType: DocumentType;
  search?: string | undefined;
  state?: DocumentState | undefined;
  page: number;
  pageSize: number;
}>;

/** Comprobantes, su historial de transiciones y el diagnóstico de los intentos (design D3 y D10). */
export interface DocumentRepository {
  insertReserved(document: NewReservedDocument): Promise<StoredDocument>;
  /** Registra una transición en la misma transacción del cambio; de solo agregado. */
  recordTransition(transition: {
    companyId: string;
    documentId: string;
    from: DocumentState | null;
    to: DocumentState;
    cause: string;
    actor: TransitionActor;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<void>;
  find(companyId: string, documentId: string): Promise<StoredDocument | null>;
  /** Por número o comprador, del más reciente al más antiguo. */
  list(
    companyId: string,
    query: DocumentListQuery,
  ): Promise<{ items: StoredDocument[]; total: number }>;
  /**
   * Toma el arriendo del intento hasta `until` si sigue `RESERVED` y nadie lo tiene vigente en
   * `now` (design D9); true si lo tomó.
   */
  acquireAttemptLease(
    companyId: string,
    documentId: string,
    now: Date,
    until: Date,
  ): Promise<boolean>;
  /** Fallo del intento: diagnóstico, un intento más y el arriendo liberado; el estado no cambia. */
  recordAttemptFailure(
    companyId: string,
    documentId: string,
    diagnostic: AttemptDiagnostic,
  ): Promise<void>;
  /** `RESERVED` → `SIGNED`, con un intento más y el arriendo liberado; true si cambió. */
  markSigned(companyId: string, documentId: string, signedAt: Date): Promise<boolean>;
}

/** Metadatos no sensibles del artefacto: esquema, hashes, versiones y huella del certificado. */
export type ArtifactMetadata = Readonly<
  Record<string, string | number | boolean | null | readonly unknown[]>
>;

export type NewArtifact = Readonly<{
  companyId: string;
  documentId: string;
  kind: ArtifactKind;
  mediaType: "application/xml";
  /** Bytes exactos: lo que se firmó es lo que se guarda y lo que se enviará (cambio 7). */
  content: Buffer;
  metadata: ArtifactMetadata;
}>;

export type ArtifactSummary = Readonly<{
  id: string;
  kind: ArtifactKind;
  mediaType: string;
  sha256: string;
  sizeBytes: number;
  metadata: ArtifactMetadata;
  createdAt: Date;
}>;

export type StoredArtifact = ArtifactSummary & Readonly<{ content: Buffer }>;

/**
 * Artefactos de los comprobantes (ADR 0010): de solo agregado, en PostgreSQL detrás de este puerto.
 * El adaptador calcula el SHA-256 y el tamaño de los bytes exactos.
 */
export interface ArtifactStore {
  save(artifact: NewArtifact): Promise<ArtifactSummary>;
  summary(
    companyId: string,
    documentId: string,
    kind: ArtifactKind,
  ): Promise<ArtifactSummary | null>;
  /** Bytes exactos del artefacto, para el envío al SRI (cambio 7). */
  read(companyId: string, documentId: string, kind: ArtifactKind): Promise<StoredArtifact | null>;
}

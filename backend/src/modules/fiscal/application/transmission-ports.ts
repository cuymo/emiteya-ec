// Puertos de la transmisión al SRI (add-sri-transmission, design D2, D7, D15 y D18). La
// infraestructura los implementa con Prisma; los casos de uso solo ven datos del dominio.
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { JobStore, NewJob } from "../../../platform/jobs/jobs.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { SriService, TransportOutcome } from "../../sri-engine/application/transport.ts";
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import type { DocumentState } from "../domain/document.ts";
import type { SriMessage, SriOperation, SriOutcome } from "../domain/transmission.ts";
import type { StoredDocument } from "./ports.ts";

/** La transmisión se detuvo: el último job del SRI del comprobante terminó `STOPPED`. */
export type TransmissionStop = Readonly<{ code: string; at: Date }>;

export type AttemptResultSummary = Readonly<{
  operation: SriOperation;
  outcome: SriOutcome;
  at: Date;
  messages: readonly SriMessage[];
}>;

export type TransmissionSummary = Readonly<{
  /** Hay un job `sri.*` activo: una interacción con el SRI en curso o programada. */
  inProgress: boolean;
  stopped: TransmissionStop | null;
  /** El último intento clasificado. */
  lastResult: AttemptResultSummary | null;
}>;

export type TransmissionEvent =
  | Readonly<{
      kind: "TRANSITION";
      at: Date;
      from: DocumentState | null;
      to: DocumentState;
      cause: string;
      actor: "SYSTEM" | "USER";
      actorName: string | null;
    }>
  | Readonly<{
      kind: "ATTEMPT";
      at: Date;
      operation: SriOperation;
      origin: "AUTOMATIC" | "MANUAL";
      /** Null mientras el intento espera su clasificación. */
      outcome: SriOutcome | null;
      messages: readonly SriMessage[];
    }>;

/** Lecturas de la transmisión para la consulta de facturas, sin respuestas originales ni XML. */
export interface TransmissionReader {
  summary(companyId: string, documentId: string): Promise<TransmissionSummary>;
  /** De los comprobantes dados, los que tienen su transmisión detenida. */
  stoppedAmong(companyId: string, documentIds: readonly string[]): Promise<ReadonlySet<string>>;
  /** Todos los comprobantes de la empresa con su transmisión detenida. */
  stoppedDocumentIds(companyId: string): Promise<string[]>;
  /** Las entradas más recientes del historial, transiciones e intentos, y el total. */
  history(
    companyId: string,
    documentId: string,
    limit: number,
  ): Promise<{ events: TransmissionEvent[]; total: number }>;
}

/** Transacción de una solicitud de reconciliación manual (design D15 y D19). */
export type ReconciliationRequestScope = Readonly<{
  db: DbClient;
  jobs: Pick<JobStore, "enqueueIn">;
  /** Bloquea la fila del comprobante hasta el fin de la transacción y lo devuelve. */
  lockDocument(companyId: string, documentId: string): Promise<StoredDocument | null>;
  audit: AuditLog;
}>;

export interface ReconciliationRequestUnitOfWork {
  run<T>(work: (scope: ReconciliationRequestScope) => Promise<T>): Promise<T>;
}

/** Un intento con el SRI tal como lo devolvió el transporte (design D7). */
export type NewSriAttempt = Readonly<{
  companyId: string;
  documentId: string;
  jobId: string | null;
  operation: SriService;
  environment: Environment;
  endpoint: string;
  origin: "AUTOMATIC" | "MANUAL";
  initiatedBy: string | null;
  outcome: TransportOutcome;
  envelope: Buffer;
  /** En los envíos: el `SIGNED_XML` enviado. */
  sentArtifact?: Readonly<{ sha256: string; sizeBytes: number }>;
}>;

/** Intento guardado, con la respuesta original reconstruida para clasificarla otra vez. */
export type StoredSriAttempt = Readonly<{
  id: string;
  attemptNumber: number;
  jobId: string | null;
  operation: SriService;
  origin: "AUTOMATIC" | "MANUAL";
  initiatedBy: string | null;
  outcome: TransportOutcome;
}>;

export type NewSriAttemptResult = Readonly<{
  companyId: string;
  attemptId: string;
  outcome: SriOutcome;
  messages: readonly SriMessage[];
  parsed: Readonly<Record<string, string | number | boolean | null>> | null;
  classifierVersion: string;
}>;

/** Resultado guardado de un intento del comprobante: la evidencia de las decisiones (design D15). */
export type StoredSriResult = Readonly<{
  attemptId: string;
  operation: SriService;
  outcome: SriOutcome;
  at: Date;
}>;

/**
 * Evidencia de los intentos (design D7 y D8). `record` confirma el intento y su respuesta antes de
 * clasificar (TX A); `recordResult` va en la transacción de la decisión (TX B).
 */
export interface SriEvidenceRepository {
  record(attempt: NewSriAttempt): Promise<StoredSriAttempt>;
  /** El último intento del job sin resultado: una caída entre la TX A y la TX B. */
  unclassified(companyId: string, jobId: string): Promise<StoredSriAttempt | null>;
  recordResult(result: NewSriAttemptResult): Promise<void>;
  /** Resultados de los intentos del comprobante, del más antiguo al más reciente. */
  results(companyId: string, documentId: string): Promise<StoredSriResult[]>;
  /** Intentos registrados por un job, de cualquier operación. */
  countForJob(companyId: string, jobId: string): Promise<number>;
}

export type { NewJob };

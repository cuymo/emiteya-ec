// Puertos de la numeración fiscal (add-fiscal-numbering, design D1 a D4). La infraestructura los
// implementa con Prisma; los casos de uso solo ven datos del dominio.
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { EstablishmentRepository } from "../../taxpayer/application/ports.ts";
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import type { CounterState, DocumentType } from "../domain/numbering.ts";

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

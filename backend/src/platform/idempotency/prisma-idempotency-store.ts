// Registro de idempotencia sobre PostgreSQL (add-invoice-emission, design D8): de solo agregado,
// con clave primaria `(company_id, operation, idempotency_key)` como última defensa.
import type { DbClient } from "../db/database.ts";
import {
  IdempotencyCollisionError,
  type IdempotencyStore,
  type IdempotentOperation,
} from "./idempotency.ts";

/** Violación de la restricción única (P2002 de Prisma o 23505 de PostgreSQL). */
function isUniqueViolation(error: unknown): boolean {
  const record = error as { code?: unknown; message?: unknown } | null;
  return (
    record?.code === "P2002" ||
    record?.code === "23505" ||
    (typeof record?.message === "string" && /unique constraint|23505/i.test(record.message))
  );
}

export function createIdempotencyStore(db: DbClient): IdempotencyStore {
  return {
    async find(companyId, operation, key) {
      const row = await db.idempotencyRecord.findUnique({
        where: {
          companyId_operation_idempotencyKey: { companyId, operation, idempotencyKey: key },
        },
      });
      if (!row) return null;
      return {
        companyId: row.companyId,
        operation: row.operation as IdempotentOperation,
        key: row.idempotencyKey,
        fingerprint: row.requestFingerprint,
        documentId: row.documentId,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
      };
    },

    async insert(record) {
      try {
        await db.idempotencyRecord.create({
          data: {
            companyId: record.companyId,
            operation: record.operation,
            idempotencyKey: record.key,
            requestFingerprint: record.fingerprint,
            documentId: record.documentId,
            createdBy: record.createdBy,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new IdempotencyCollisionError();
        throw error;
      }
    },
  };
}

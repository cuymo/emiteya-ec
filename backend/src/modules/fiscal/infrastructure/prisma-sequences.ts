// Contadores y reservas en PostgreSQL (add-fiscal-numbering, design D2 a D4 y D9). Toda consulta
// exige la empresa. La reserva avanza el contador con un UPDATE que bloquea su fila hasta el fin de
// la transacción; la creación perezosa es un INSERT ... ON CONFLICT DO NOTHING, que nunca produce un
// error de restricción única ante dos primeras reservas simultáneas.
import type { DbClient } from "../../../platform/db/database.ts";
import type { SequenceKey, SequenceRepository, StoredCounter } from "../application/ports.ts";
import { SEQUENTIAL_MAX, SEQUENTIAL_MIN, type DocumentType } from "../domain/numbering.ts";
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";

const unique = (key: SequenceKey) => ({
  companyId_environment_establishmentId_emissionPointId_documentType: key,
});

export function createSequenceRepository(db: DbClient): SequenceRepository {
  return {
    async ensure(key) {
      await db.fiscalSequence.createMany({
        data: [{ ...key, nextNumber: SEQUENTIAL_MIN }],
        skipDuplicates: true,
      });
    },

    async find(key) {
      const row = await db.fiscalSequence.findUnique({
        where: unique(key),
        select: { nextNumber: true, lastReserved: true },
      });
      return row ?? null;
    },

    async listForCompany(companyId, environment) {
      const rows = await db.fiscalSequence.findMany({ where: { companyId, environment } });
      return rows.map((row): StoredCounter => ({
        key: {
          companyId: row.companyId,
          environment: row.environment as Environment,
          establishmentId: row.establishmentId,
          emissionPointId: row.emissionPointId,
          documentType: row.documentType as DocumentType,
        },
        nextNumber: row.nextNumber,
        lastReserved: row.lastReserved,
      }));
    },

    async increment(key) {
      try {
        const row = await db.fiscalSequence.update({
          where: { ...unique(key), nextNumber: { lte: SEQUENTIAL_MAX } },
          data: { nextNumber: { increment: 1 } },
          select: { nextNumber: true },
        });
        return row.nextNumber - 1;
      } catch (error) {
        // Sin fila que cumpla el where: el contador existe (ensure) y está agotado (design D6).
        if ((error as { code?: unknown } | null)?.code === "P2025") return null;
        throw error;
      }
    },

    async setLastReserved(key, sequential) {
      await db.fiscalSequence.update({ where: unique(key), data: { lastReserved: sequential } });
    },

    async record({ key, sequential, reservedBy, correlationId }) {
      return db.fiscalSequenceReservation.create({
        data: { ...key, sequential, reservedById: reservedBy, correlationId },
        select: { id: true },
      });
    },

    async adjust(key, expected, next) {
      const { count } = await db.fiscalSequence.updateMany({
        where: {
          ...key,
          nextNumber: expected,
          OR: [{ lastReserved: null }, { lastReserved: { lt: next } }],
        },
        data: { nextNumber: next },
      });
      return count === 1;
    },
  };
}

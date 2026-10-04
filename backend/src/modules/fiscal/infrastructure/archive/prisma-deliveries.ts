// Historial de entregas en PostgreSQL (add-document-archive, design D9): de solo agregado, con FK
// compuesta al comprobante, FK al artefacto y el actor que no se puede borrar.
import type { DbClient } from "../../../../platform/db/database.ts";
import type {
  DeliveryEvent,
  DeliveryRepository,
} from "../../application/archive/delivery-ports.ts";
import type { ArtifactKind } from "../../domain/document.ts";

export function createDeliveryRepository(db: DbClient): DeliveryRepository {
  return {
    async record(delivery) {
      const row = await db.documentDeliveryEvent.create({
        data: delivery,
        select: { id: true, occurredAt: true },
      });
      return row;
    },

    async list(companyId, documentId, limit) {
      const where = { companyId, documentId };
      const [rows, total] = await Promise.all([
        db.documentDeliveryEvent.findMany({
          where,
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: limit,
          select: {
            id: true,
            event: true,
            artifactKind: true,
            occurredAt: true,
            actor: { select: { name: true } },
          },
        }),
        db.documentDeliveryEvent.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          event: row.event as DeliveryEvent,
          artifactKind: row.artifactKind as ArtifactKind,
          actorName: row.actor.name,
          occurredAt: row.occurredAt,
        })),
        total,
      };
    },
  };
}

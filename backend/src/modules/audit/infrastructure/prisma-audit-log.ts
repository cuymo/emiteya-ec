// Rastro de auditoría sobre PostgreSQL. Recibe el cliente o la transacción en curso, para escribir
// el evento en la misma transacción que el cambio (design D2).
import type { DbClient } from "../../../platform/db/database.ts";
import type { AuditLog, AuditReader } from "../application/audit-log.ts";
import {
  assertNoSecrets,
  type AuditActor,
  type AuditAction,
  type AuditChanges,
  type AuditEvent,
} from "../domain/audit-event.ts";

const MAX_LIST = 500;

export function createAuditLog(db: DbClient): AuditLog & AuditReader {
  return {
    async append(event) {
      assertNoSecrets(event.changes);
      await db.auditEvent.create({
        data: {
          companyId: event.companyId,
          actorType: event.actor.type,
          actorUserId: event.actor.type === "USER" ? event.actor.userId : null,
          action: event.action,
          targetUserId: event.targetUserId ?? null,
          ...(event.changes ? { changes: event.changes } : {}),
          correlationId: event.correlationId,
        },
      });
    },

    async listForCompany(companyId, options = {}) {
      const rows = await db.auditEvent.findMany({
        where: { companyId },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: Math.min(options.limit ?? MAX_LIST, MAX_LIST),
      });
      return rows.map((row): AuditEvent => ({
        id: row.id,
        companyId: row.companyId,
        actor: toActor(row.actorType, row.actorUserId),
        action: row.action as AuditAction,
        ...(row.targetUserId ? { targetUserId: row.targetUserId } : {}),
        ...(row.changes ? { changes: row.changes as AuditChanges } : {}),
        correlationId: row.correlationId,
        occurredAt: row.occurredAt,
      }));
    },
  };
}

function toActor(type: string, userId: string | null): AuditActor {
  if (type === "USER" && userId) return { type: "USER", userId };
  if (type === "SYSTEM" || type === "TECHNICAL_ADMIN") return { type };
  throw new Error(`Actor de auditoría inesperado: ${type}`);
}

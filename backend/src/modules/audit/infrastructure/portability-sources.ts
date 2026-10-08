// Fuente de portabilidad de la auditoría (add-data-portability, design D4): los eventos de la
// empresa con lo que su política conserva. La auditoría no guarda IP, user agent, secretos, XML ni
// respuestas del SRI, y esta fuente no los agrega.
import { Prisma } from "../../../generated/prisma/client.ts";
import { qualifiedTable, sqlCompanyBatches } from "../../../platform/db/report-source.ts";

export function createAuditPortabilitySources(schema: string) {
  const events = qualifiedTable(schema, "audit_event");
  return {
    auditEvents: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`e.occurred_at, e.actor_type, e.actor_user_id, e.action,
          e.target_user_id, e.changes`,
        from: Prisma.sql`${events} e WHERE e.company_id = ${companyId}`,
        orderBy: Prisma.sql`e.occurred_at, e.id`,
      }),
      map: (raw: {
        occurred_at: Date;
        actor_type: string;
        actor_user_id: string | null;
        action: string;
        target_user_id: string | null;
        changes: unknown;
      }) => ({
        occurredAt: raw.occurred_at,
        actorType: raw.actor_type,
        actorUserId: raw.actor_user_id,
        action: raw.action,
        targetUserId: raw.target_user_id,
        changes: raw.changes,
      }),
    }),
  };
}

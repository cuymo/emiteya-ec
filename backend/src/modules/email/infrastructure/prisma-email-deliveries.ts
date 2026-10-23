// Envíos por correo sobre PostgreSQL (add-email-delivery, design D8): el envío, que cambia de estado,
// y sus intentos, de solo agregado. Toda consulta filtra por la empresa. El alta automática usa
// `ON CONFLICT DO NOTHING` sobre el índice único parcial: corre en la transacción del RIDE y un
// duplicado no debe abortarla.
import { randomUUID } from "node:crypto";
import type { EmailDeliveryStatus, Environment } from "@facturador/contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { qualifiedTable } from "../../../platform/db/report-source.ts";
import type {
  DeliveryRecipient,
  DeliveryUpdate,
  EmailDeliveryRecord,
  EmailDeliveryRepository,
} from "../application/ports.ts";
import type { EmailFailureCode } from "../domain/failures.ts";

type DeliveryRow = Prisma.EmailDeliveryGetPayload<object>;

const recipientsOf = (value: unknown): DeliveryRecipient[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (typeof item !== "object" || item === null) return [];
        const { address, outcome, reason } = item as Record<string, unknown>;
        if (typeof address !== "string") return [];
        return [
          {
            address,
            outcome: outcome === "ACCEPTED" || outcome === "REJECTED" ? outcome : null,
            reason: typeof reason === "string" ? reason : null,
          },
        ];
      })
    : [];

export function toDeliveryRecord(row: DeliveryRow): EmailDeliveryRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    documentId: row.documentId,
    origin: row.origin as EmailDeliveryRecord["origin"],
    requestedBy: row.requestedBy,
    environment: row.environment as Environment,
    testRedirect: row.testRedirect,
    status: row.status as EmailDeliveryStatus,
    recipients: recipientsOf(row.recipients),
    attemptCount: row.attemptCount,
    failureCode: row.failureCode as EmailFailureCode | null,
    failureReason: row.failureReason,
    messageId: row.messageId,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    finishedAt: row.finishedAt,
  };
}

const dataOf = (update: DeliveryUpdate) => ({
  status: update.status,
  failureCode: update.failureCode,
  failureReason: update.failureReason,
  finishedAt: update.finishedAt,
  ...(update.recipients !== undefined
    ? { recipients: update.recipients.map((r) => ({ ...r })) as Prisma.InputJsonValue }
    : {}),
  ...(update.testRedirect !== undefined ? { testRedirect: update.testRedirect } : {}),
  ...(update.messageId !== undefined ? { messageId: update.messageId } : {}),
  ...(update.sentAt !== undefined ? { sentAt: update.sentAt } : {}),
});

/** `schema` es el de la conexión: el alta automática usa SQL y califica su tabla, como la cola. */
export function createEmailDeliveryRepository(
  db: DbClient,
  schema = "public",
): EmailDeliveryRepository {
  const table = qualifiedTable(schema, "email_delivery");
  return {
    async find(companyId, deliveryId) {
      const row = await db.emailDelivery.findFirst({ where: { id: deliveryId, companyId } });
      return row ? toDeliveryRecord(row) : null;
    },

    async createAutomatic(input) {
      const id = randomUUID();
      const inserted = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO ${table}
          ("id", "company_id", "document_id", "origin", "environment", "status", "failure_code",
           "failure_reason", "created_at", "finished_at")
        VALUES (${id}, ${input.companyId}, ${input.documentId}, 'AUTOMATIC', ${input.environment},
          ${input.status}, ${input.failureCode}, ${input.failureReason}, ${input.at},
          ${input.status === "PENDING" ? null : input.at})
        ON CONFLICT ("document_id") WHERE "origin" = 'AUTOMATIC' DO NOTHING
        RETURNING "id"`;
      return inserted[0]?.id ?? null;
    },

    async update(companyId, deliveryId, update) {
      await db.emailDelivery.updateMany({
        where: { id: deliveryId, companyId },
        data: dataOf(update),
      });
    },

    async recordAttempt(companyId, deliveryId, attempt, update) {
      await db.emailDeliveryAttempt.create({
        data: {
          deliveryId,
          number: attempt.number,
          at: attempt.at,
          outcome: attempt.outcome,
          smtpCode: attempt.smtpCode,
          detail: attempt.detail,
        },
      });
      await db.emailDelivery.updateMany({
        where: { id: deliveryId, companyId },
        data: { ...dataOf(update), attemptCount: attempt.number },
      });
    },
  };
}

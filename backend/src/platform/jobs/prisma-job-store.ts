// Repositorio de la cola durable (design D5). La selección usa SQL crudo con `FOR UPDATE SKIP
// LOCKED` y la tabla calificada con el esquema configurado: el adapter de Prisma no califica el SQL
// crudo. Las demás escrituras van guardadas por el dueño del arriendo y aceptan una transacción en
// curso, para que el handler confirme su decisión y el traspaso al siguiente job juntos.
import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import type { DbClient } from "../db/database.ts";
import {
  DOCUMENT_EXCLUSIVE_PREFIX,
  LeaseLostError,
  backoffDelayMs,
  type Job,
  type JobError,
  type JobErrorClass,
  type JobOrigin,
  type JobStatus,
  type JobStore,
} from "./jobs.ts";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

type JobRow = Prisma.JobGetPayload<object>;

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    companyId: row.companyId,
    type: row.type,
    dedupeKey: row.dedupeKey,
    documentId: row.documentId,
    payload: row.payload as Record<string, unknown>,
    status: row.status as JobStatus,
    scheduledAt: row.scheduledAt,
    nextAttemptAt: row.nextAttemptAt,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    deadlineAt: row.deadlineAt,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    lastErrorCode: row.lastErrorCode,
    lastErrorClass: row.lastErrorClass as JobErrorClass | null,
    origin: row.origin as JobOrigin,
    requestedBy: row.requestedBy,
    reason: row.reason,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

const errorColumns = (error: JobError, now: Date) => ({
  lastErrorCode: error.code,
  lastErrorClass: error.errorClass,
  lastErrorAt: now,
  lastErrorDetail: (error.detail ?? {}) as Prisma.InputJsonObject,
});

/** El motivo de la detención conserva el último error y dice qué límite se agotó. */
const exhausted = (error: JobError, limit: "ATTEMPTS" | "DEADLINE"): JobError => ({
  ...error,
  detail: { ...error.detail, exhaustedLimit: limit },
});

const finished = { activeDedupeKey: null, activeSriDocumentId: null, leaseOwner: null };

export type { ClaimRequest, JobStore } from "./jobs.ts";

export function createPrismaJobStore(prisma: PrismaClient, schema = "public"): JobStore {
  if (!IDENTIFIER.test(schema)) throw new Error("esquema de base de datos inválido");
  const table = `"${schema}"."job"`;

  /** Actualización guardada por el arriendo: sin él no hay efecto y la decisión se revierte. */
  async function guarded(db: DbClient, job: Job, data: Prisma.JobUpdateManyMutationInput) {
    const { count } = await db.job.updateMany({
      where: { id: job.id, status: "LEASED", leaseOwner: job.leaseOwner },
      data,
    });
    if (count !== 1) throw new LeaseLostError(job.id);
  }

  async function stop(db: DbClient, job: Job, error: JobError, now: Date) {
    await guarded(db, job, {
      ...finished,
      status: "STOPPED",
      leaseExpiresAt: null,
      completedAt: now,
      ...errorColumns(error, now),
    });
  }

  const reschedule: JobStore["reschedule"] = async (
    db,
    job,
    { at, now, consumeAttempt, error },
  ) => {
    if (job.deadlineAt && at > job.deadlineAt) {
      await stop(
        db,
        job,
        exhausted(error ?? { code: "DEADLINE_EXCEEDED", errorClass: "RETRYABLE" }, "DEADLINE"),
        now,
      );
      return "STOPPED";
    }
    await guarded(db, job, {
      status: "PENDING",
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: at,
      ...(consumeAttempt ? {} : { attemptCount: { decrement: 1 } }),
      ...(error ? errorColumns(error, now) : {}),
    });
    return "PENDING";
  };

  return {
    async enqueueIn(db, job) {
      const documentId = job.documentId ?? null;
      const { count } = await db.job.createMany({
        data: {
          companyId: job.companyId,
          type: job.type,
          dedupeKey: job.dedupeKey,
          activeDedupeKey: job.dedupeKey,
          documentId,
          activeSriDocumentId:
            documentId && job.type.startsWith(DOCUMENT_EXCLUSIVE_PREFIX) ? documentId : null,
          payload: (job.payload ?? {}) as Prisma.InputJsonObject,
          status: "PENDING",
          scheduledAt: job.runAt,
          nextAttemptAt: job.runAt,
          maxAttempts: job.maxAttempts,
          deadlineAt: job.deadlineAt ?? null,
          origin: job.origin ?? "AUTOMATIC",
          requestedBy: job.requestedBy ?? null,
          reason: job.reason ?? null,
        },
        // INSERT … ON CONFLICT DO NOTHING: la clave activa ya existe.
        skipDuplicates: true,
      });
      return count === 1;
    },

    async claim({ owner, types, limit, leaseMs, now }) {
      if (types.length === 0 || limit < 1) return [];
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const claimed = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE ${table}
            SET "status" = 'LEASED', "lease_owner" = $1, "lease_expires_at" = $2,
                "attempt_count" = "attempt_count" + 1, "updated_at" = $3
          WHERE "id" IN (
            SELECT "id" FROM ${table}
             WHERE "type" = ANY($4::text[])
               AND (("status" = 'PENDING' AND "next_attempt_at" <= $3)
                 OR ("status" = 'LEASED' AND "lease_expires_at" <= $3))
             ORDER BY "next_attempt_at", "id"
             LIMIT $5
             FOR UPDATE SKIP LOCKED)
          RETURNING "id"`,
        owner,
        leaseExpiresAt,
        now,
        types,
        limit,
      );
      if (claimed.length === 0) return [];
      const rows = await prisma.job.findMany({
        where: { id: { in: claimed.map((row) => row.id) }, leaseOwner: owner },
        orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      });
      return rows.map(toJob);
    },

    async complete(db, job, now) {
      await guarded(db, job, {
        ...finished,
        status: "DONE",
        leaseExpiresAt: null,
        completedAt: now,
      });
    },

    reschedule,

    async fail(db, job, error, { backoff, now, random }) {
      if (error.errorClass !== "RETRYABLE") {
        await stop(db, job, error, now);
        return "STOPPED";
      }
      if (job.attemptCount >= job.maxAttempts) {
        await stop(db, job, exhausted(error, "ATTEMPTS"), now);
        return "STOPPED";
      }
      const at = new Date(now.getTime() + backoffDelayMs(job.attemptCount, backoff, random));
      return reschedule(db, job, { at, now, consumeAttempt: true, error });
    },

    stop,

    async release(owner, now) {
      const { count } = await prisma.job.updateMany({
        where: { status: "LEASED", leaseOwner: owner },
        data: { leaseExpiresAt: now },
      });
      return count;
    },
  };
}

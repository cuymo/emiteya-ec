// Lecturas de la transmisión sobre Prisma (add-sri-transmission, design D18): resumen, historial y
// transmisiones detenidas. Nunca leen el cuerpo de las respuestas originales ni los artefactos.
import type { DbClient } from "../../../platform/db/database.ts";
import type { DocumentState } from "../domain/document.ts";
import type { SriMessage, SriOperation, SriOutcome } from "../domain/transmission.ts";
import type {
  TransmissionEvent,
  TransmissionReader,
  TransmissionStop,
} from "../application/transmission-ports.ts";

const SRI_JOB = { startsWith: "sri." };
const ACTIVE = ["PENDING", "LEASED"];

/** Mensajes guardados por el clasificador; un campo ausente se lee como null. */
export function readMessages(value: unknown): SriMessage[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: Record<string, unknown>) => ({
    identifier: typeof item.identifier === "string" ? item.identifier : null,
    message: typeof item.message === "string" ? item.message : null,
    additionalInformation:
      typeof item.additionalInformation === "string" ? item.additionalInformation : null,
    type: typeof item.type === "string" ? item.type : null,
  }));
}

type JobRow = {
  documentId: string | null;
  status: string;
  lastErrorCode: string | null;
  completedAt: Date | null;
};

/** El último job del SRI de cada comprobante decide si su transmisión está detenida. */
function stopsOf(rows: readonly JobRow[]): Map<string, TransmissionStop> {
  const latest = new Map<string, JobRow>();
  for (const row of rows)
    if (row.documentId && !latest.has(row.documentId)) latest.set(row.documentId, row);
  const stops = new Map<string, TransmissionStop>();
  for (const [documentId, row] of latest) {
    if (row.status === "STOPPED") {
      stops.set(documentId, { code: row.lastErrorCode ?? "STOPPED", at: row.completedAt! });
    }
  }
  return stops;
}

const LATEST_FIRST = [{ createdAt: "desc" as const }, { id: "desc" as const }];
const JOB_FIELDS = { documentId: true, status: true, lastErrorCode: true, completedAt: true };

export function createTransmissionReader(db: DbClient): TransmissionReader {
  async function stoppedAmong(companyId: string, documentIds: readonly string[]) {
    if (documentIds.length === 0) return new Set<string>();
    const rows = await db.job.findMany({
      where: { companyId, documentId: { in: [...documentIds] }, type: SRI_JOB },
      orderBy: LATEST_FIRST,
      select: JOB_FIELDS,
    });
    return new Set(stopsOf(rows).keys());
  }

  return {
    async summary(companyId, documentId) {
      const [jobs, attempt] = await Promise.all([
        db.job.findMany({
          where: { companyId, documentId, type: SRI_JOB },
          orderBy: LATEST_FIRST,
          take: 1,
          select: JOB_FIELDS,
        }),
        db.sriAttempt.findFirst({
          where: { companyId, documentId, result: { isNot: null } },
          orderBy: [{ startedAt: "desc" }, { attemptNumber: "desc" }],
          select: { operation: true, startedAt: true, result: true },
        }),
      ]);
      const last = jobs[0];
      return {
        inProgress: last !== undefined && ACTIVE.includes(last.status),
        stopped: stopsOf(jobs).get(documentId) ?? null,
        lastResult: attempt?.result
          ? {
              operation: attempt.operation as SriOperation,
              outcome: attempt.result.outcome as SriOutcome,
              at: attempt.result.createdAt,
              messages: readMessages(attempt.result.messages),
            }
          : null,
      };
    },

    stoppedAmong,

    async stoppedDocumentIds(companyId) {
      // Los detenidos son pocos y alertados: se parte de ellos y se descartan los que tienen un job
      // posterior, por ejemplo una reconciliación manual que reactivó la transmisión.
      const stopped = await db.job.findMany({
        where: { companyId, type: SRI_JOB, status: "STOPPED" },
        select: { documentId: true },
        distinct: ["documentId"],
      });
      const ids = stopped.flatMap((row) => (row.documentId ? [row.documentId] : []));
      return [...(await stoppedAmong(companyId, ids))];
    },

    async history(companyId, documentId, limit) {
      const [transitions, attempts, transitionCount, attemptCount] = await Promise.all([
        db.documentStateTransition.findMany({
          where: { companyId, documentId },
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          take: limit,
          select: {
            occurredAt: true,
            fromState: true,
            toState: true,
            cause: true,
            actorType: true,
            actor: { select: { name: true } },
          },
        }),
        db.sriAttempt.findMany({
          where: { companyId, documentId },
          orderBy: [{ startedAt: "desc" }, { attemptNumber: "desc" }],
          take: limit,
          select: {
            startedAt: true,
            operation: true,
            origin: true,
            result: { select: { outcome: true, messages: true } },
          },
        }),
        db.documentStateTransition.count({ where: { companyId, documentId } }),
        db.sriAttempt.count({ where: { companyId, documentId } }),
      ]);
      const events: TransmissionEvent[] = [
        ...transitions.map((row): TransmissionEvent => ({
          kind: "TRANSITION",
          at: row.occurredAt,
          from: row.fromState as DocumentState | null,
          to: row.toState as DocumentState,
          cause: row.cause,
          actor: row.actorType === "USER" ? "USER" : "SYSTEM",
          actorName: row.actor?.name ?? null,
        })),
        ...attempts.map((row): TransmissionEvent => ({
          kind: "ATTEMPT",
          at: row.startedAt,
          operation: row.operation as SriOperation,
          origin: row.origin === "MANUAL" ? "MANUAL" : "AUTOMATIC",
          outcome: (row.result?.outcome as SriOutcome | undefined) ?? null,
          messages: readMessages(row.result?.messages),
        })),
      ];
      events.sort((a, b) => b.at.getTime() - a.at.getTime());
      return { events: events.slice(0, limit), total: transitionCount + attemptCount };
    },
  };
}

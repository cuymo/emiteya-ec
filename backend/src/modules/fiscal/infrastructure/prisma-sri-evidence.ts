// Evidencia de los intentos con el SRI sobre Prisma (add-sri-transmission, design D7 y D8): el
// intento y su respuesta original se insertan juntos y una sola vez; el resultado, después. Las
// tres tablas son de solo agregado y referencian el comprobante de la misma empresa.
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type {
  SafeHeaders,
  SriService,
  TransportFailure,
  TransportOutcome,
} from "../../sri-engine/application/transport.ts";
import type { SriOutcome } from "../domain/transmission.ts";
import type { SriEvidenceRepository, StoredSriAttempt } from "../application/transmission-ports.ts";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

type AttemptRow = Prisma.SriAttemptGetPayload<{ include: { response: true } }>;

/** Reconstruye el resultado del transporte desde la evidencia guardada (design D8). */
function toStored(row: AttemptRow): StoredSriAttempt {
  const timings = {
    startedAt: row.startedAt,
    headersAt: row.headersAt,
    completedAt: row.completedAt,
  };
  const outcome: TransportOutcome =
    row.transportOutcome === "RESPONSE"
      ? {
          kind: "RESPONSE",
          httpStatus: row.httpStatus!,
          headers: (row.responseHeaders ?? {}) as SafeHeaders,
          body: row.response ? Buffer.from(row.response.body) : Buffer.alloc(0),
          truncated: row.response?.truncated ?? false,
          ...timings,
        }
      : {
          kind: row.transportOutcome as TransportFailure,
          errorCode: row.transportErrorCode ?? "UNKNOWN",
          ...timings,
        };
  return {
    id: row.id,
    attemptNumber: row.attemptNumber,
    jobId: row.jobId,
    operation: row.operation as SriService,
    origin: row.origin === "MANUAL" ? "MANUAL" : "AUTOMATIC",
    initiatedBy: row.initiatedBy,
    outcome,
  };
}

/**
 * Repositorio de la evidencia. `record` abre su propia transacción (TX A) salvo que reciba una en
 * curso; el resto acepta el cliente o la transacción de la decisión.
 */
export function createSriEvidenceRepository(db: DbClient): SriEvidenceRepository {
  const insert = async (tx: DbClient, attempt: Parameters<SriEvidenceRepository["record"]>[0]) => {
    const last = await tx.sriAttempt.findFirst({
      where: { documentId: attempt.documentId },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true },
    });
    const { outcome } = attempt;
    const created = await tx.sriAttempt.create({
      data: {
        companyId: attempt.companyId,
        documentId: attempt.documentId,
        jobId: attempt.jobId,
        attemptNumber: (last?.attemptNumber ?? 0) + 1,
        operation: attempt.operation,
        environment: attempt.environment,
        endpoint: attempt.endpoint,
        origin: attempt.origin,
        initiatedBy: attempt.initiatedBy,
        startedAt: outcome.startedAt,
        headersAt: outcome.headersAt,
        completedAt: outcome.completedAt,
        transportOutcome: outcome.kind,
        httpStatus: outcome.kind === "RESPONSE" ? outcome.httpStatus : null,
        ...(outcome.kind === "RESPONSE" ? { responseHeaders: outcome.headers } : {}),
        transportErrorCode: outcome.kind === "RESPONSE" ? null : outcome.errorCode,
        envelopeSha256: sha256(attempt.envelope),
        envelopeSize: attempt.envelope.length,
        sentArtifactSha256: attempt.sentArtifact?.sha256 ?? null,
        sentArtifactSize: attempt.sentArtifact?.sizeBytes ?? null,
      },
    });
    // Sin cuerpo no hay respuesta original que guardar (design D7).
    if (outcome.kind === "RESPONSE" && outcome.body.length > 0) {
      await tx.sriResponse.create({
        data: {
          attemptId: created.id,
          companyId: attempt.companyId,
          body: new Uint8Array(outcome.body),
          sizeBytes: outcome.body.length,
          sha256: sha256(outcome.body),
          contentType: outcome.headers["content-type"] ?? null,
          truncated: outcome.truncated,
        },
      });
    }
    return tx.sriAttempt.findUniqueOrThrow({
      where: { id: created.id },
      include: { response: true },
    });
  };

  return {
    async record(attempt) {
      const row =
        "$transaction" in db
          ? await (db as PrismaClient).$transaction((tx) => insert(tx, attempt))
          : await insert(db, attempt);
      return toStored(row);
    },

    async unclassified(companyId, jobId) {
      const row = await db.sriAttempt.findFirst({
        where: { companyId, jobId, result: { is: null } },
        orderBy: { attemptNumber: "desc" },
        include: { response: true },
      });
      return row ? toStored(row) : null;
    },

    async recordResult(result) {
      await db.sriAttemptResult.create({
        data: {
          attemptId: result.attemptId,
          companyId: result.companyId,
          outcome: result.outcome,
          messages: result.messages.map((message) => ({ ...message })),
          ...(result.parsed ? { parsed: result.parsed } : {}),
          classifierVersion: result.classifierVersion,
        },
      });
    },

    async results(companyId, documentId) {
      const rows = await db.sriAttempt.findMany({
        where: { companyId, documentId, result: { isNot: null } },
        orderBy: { attemptNumber: "asc" },
        select: {
          id: true,
          operation: true,
          result: { select: { outcome: true, createdAt: true } },
        },
      });
      return rows.map((row) => ({
        attemptId: row.id,
        operation: row.operation as SriService,
        outcome: row.result!.outcome as SriOutcome,
        at: row.result!.createdAt,
      }));
    },

    countForJob: (companyId, jobId) => db.sriAttempt.count({ where: { companyId, jobId } }),
  };
}

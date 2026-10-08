// Job `portability.export` (add-data-portability, design D10, D11, D14 y D15).
//
// 1. Toma la exportación con `fence`: `GENERATING` con el intento del job (su token monótono).
// 2. Renueva el *lease* con un heartbeat; si una renovación falla, aborta la generación.
// 3. Genera el paquete en `<exportId>-<intento>.partial`, lo cierra con su SHA-256 y su tamaño,
//    lo renombra a `<exportId>-<intento>.zip` (`0400`) y sincroniza el directorio.
// 4. En una sola transacción: `fence`, el anterior vigente a `EXPIRED` (`REPLACED`), `READY` con su
//    caducidad desde ahora, `data_export.completed` y `complete` del job. Un worker que perdió el
//    *lease* nunca pasa el `fence`: no publica, no completa y no registra nada.
// Una falla determinista deja `FAILED` con su código y `data_export.failed`; una inesperada se
// reintenta desde el principio hasta agotar los intentos, y entonces queda `DATA_EXPORT_FAILED`.
import type { DataExportFailureCode } from "@facturador/contracts";
import type { Logger } from "pino";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { LeaseLostError, type Job, type JobStore } from "../../../platform/jobs/jobs.ts";
import type { JobHandler } from "../../../platform/jobs/runner.ts";
import { ZipLimitError } from "../../../platform/xlsx/zip.ts";
import { XlsxValueError } from "../../../platform/xlsx/cells.ts";
import { ExportFailure } from "../application/errors.ts";
import { generatePackage, type GeneratorDeps } from "../application/generate.ts";
import type { PortabilityDatabase } from "../application/ports.ts";
import type { PackageFiles } from "./package-files.ts";
import type { DataExportStore } from "./prisma-data-exports.ts";
import type { PortabilityMetrics } from "./metrics.ts";

export const EXPORT_JOB_TYPE = "portability.export";
export const EXPORT_LEASE_MS = 60_000;
export const EXPORT_HEARTBEAT_MS = 20_000;
export const EXPORT_MAX_ATTEMPTS = 3;
const BACKOFF = { baseMs: 5_000, capMs: 60_000, minMs: 1_000 };

export type ExportJobDeps = Readonly<{
  generator: Omit<GeneratorDeps, "database">;
  database: PortabilityDatabase;
  store: DataExportStore;
  jobs: Pick<JobStore, "renew" | "fence" | "complete" | "stop">;
  files: PackageFiles;
  audit: (db: DbClient) => AuditLog;
  metrics: PortabilityMetrics;
  ttlMs: number;
  logger: Pick<Logger, "info" | "warn" | "error">;
  now: () => Date;
  leaseMs?: number;
  heartbeatMs?: number;
}>;

/** El código seguro de una falla conocida; null si es inesperada (se reintenta). */
export function failureCode(error: unknown): DataExportFailureCode | null {
  if (error instanceof ExportFailure) return error.code;
  if ((error as NodeJS.ErrnoException | null)?.code === "ENOSPC") {
    return "DATA_EXPORT_INSUFFICIENT_SPACE";
  }
  if (error instanceof XlsxValueError || error instanceof ZipLimitError) return "DATA_EXPORT_LIMIT";
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
    return "DATA_EXPORT_SNAPSHOT_TIMEOUT";
  }
  return null;
}

const leaseLost = (error: unknown) =>
  error instanceof LeaseLostError ||
  (error instanceof DOMException && error.name === "AbortError") ||
  (error as { cause?: unknown } | null)?.cause instanceof LeaseLostError;

export function createExportJobHandler(deps: ExportJobDeps): JobHandler {
  const leaseMs = deps.leaseMs ?? EXPORT_LEASE_MS;
  const heartbeatMs = deps.heartbeatMs ?? EXPORT_HEARTBEAT_MS;
  const { database, store, jobs, files, metrics, logger, now } = deps;

  async function finishFailed(
    job: Job,
    exportId: string,
    companyId: string,
    code: DataExportFailureCode,
  ) {
    await database.transaction(async (tx) => {
      await jobs.fence(tx, job, now());
      const changed = await store.fail(tx, {
        id: exportId,
        code,
        now: now(),
        from: "GENERATING",
        attempt: job.attemptCount,
      });
      if (changed) {
        await deps.audit(tx).append({
          companyId,
          actor: { type: "SYSTEM" },
          action: "data_export.failed",
          changes: { exportId, code },
          correlationId: `job:${job.id}`,
        });
      }
      await jobs.stop(tx, job, { code, errorClass: "DETERMINISTIC" }, now());
    });
    metrics.failed(code);
  }

  return {
    backoff: BACKOFF,
    async run(job, context) {
      const exportId = typeof job.payload.exportId === "string" ? job.payload.exportId : null;
      if (!exportId) {
        await database.transaction(async (tx) => {
          await jobs.fence(tx, job, now());
          await jobs.stop(tx, job, { code: "INVALID_PAYLOAD", errorClass: "DETERMINISTIC" }, now());
        });
        return;
      }
      const attempt = job.attemptCount;
      const started = await database.transaction(async (tx) => {
        await jobs.fence(tx, job, now());
        const row = await store.start(tx, { id: exportId, attempt, now: now() });
        if (!row) await jobs.complete(tx, job, now());
        return row;
      });
      if (!started) return;
      const { companyId } = started;

      const lease = new AbortController();
      const signal = AbortSignal.any([lease.signal, context.signal]);
      const heartbeat = setInterval(() => {
        jobs.renew(database.db, job, { leaseMs, now: now() }).catch((error: unknown) => {
          if (error instanceof LeaseLostError) {
            metrics.leaseRenewalFailed();
            lease.abort(error);
          } else {
            logger.warn(
              { exportId, err: error },
              "no se pudo renovar el arriendo de la exportación",
            );
          }
        });
      }, heartbeatMs);
      heartbeat.unref();

      const partialPath = files.partialPath(exportId, attempt);
      const fileName = files.fileName(exportId, attempt);
      let workDir: string | null = null;
      const phaseStarted = new Map<string, number>();
      try {
        workDir = await files.workDir(exportId, attempt);
        const result = await generatePackage(
          { ...deps.generator, database },
          {
            companyId,
            workDir,
            packagePath: partialPath,
            signal,
            progress: async (phase, done, total) => {
              if (!phaseStarted.has(phase)) {
                const previous = [...phaseStarted.entries()].at(-1);
                if (previous) metrics.phase(previous[0], (Date.now() - previous[1]) / 1000);
                phaseStarted.set(phase, Date.now());
              }
              await store.progress(database.db, { id: exportId, attempt, phase, done, total });
            },
          },
        );
        signal.throwIfAborted();
        await files.publish(partialPath, fileName);
        let previous: string | null;
        try {
          previous = await database.transaction(async (tx) => {
            await jobs.fence(tx, job, now());
            const replaced = await store.publish(tx, {
              id: exportId,
              companyId,
              attempt,
              now: now(),
              ttlMs: deps.ttlMs,
              snapshotAt: result.snapshotAt,
              fileName,
              sizeBytes: result.sizeBytes,
              sha256: result.sha256,
              counts: result.counts,
            });
            await deps.audit(tx).append({
              companyId,
              actor: { type: "SYSTEM" },
              action: "data_export.completed",
              changes: {
                exportId,
                formatVersion: "1",
                documents: result.counts.documentsTest + result.counts.documentsProduction,
                documentsTest: result.counts.documentsTest,
                documentsProduction: result.counts.documentsProduction,
                files: result.counts.files,
                sizeBytes: String(result.sizeBytes),
                sha256: result.sha256,
              },
              correlationId: `job:${job.id}`,
            });
            await jobs.complete(tx, job, now());
            return replaced;
          });
        } catch (error) {
          // Nada quedó listo: el archivo publicado no es de ningún paquete y se borra.
          await files.remove(fileName).catch(() => undefined);
          throw error;
        }
        const last = [...phaseStarted.entries()].at(-1);
        if (last) metrics.phase(last[0], (Date.now() - last[1]) / 1000);
        metrics.ready(result.sizeBytes);
        if (previous) {
          await files
            .remove(previous)
            .catch((error: unknown) =>
              logger.warn({ exportId, err: error }, "no se pudo borrar el paquete reemplazado"),
            );
          metrics.expired();
        }
        logger.info(
          { exportId, sizeBytes: result.sizeBytes, files: result.counts.files },
          "paquete de portabilidad listo",
        );
      } catch (error) {
        await files.removePartial(partialPath).catch(() => undefined);
        if (leaseLost(error) || lease.signal.aborted || context.signal.aborted) {
          // Otro worker tiene el job, o la instancia se apaga: nada se confirma.
          logger.warn({ exportId }, "generación de portabilidad abortada sin publicar");
          return;
        }
        const code = failureCode(error);
        if (code === null && attempt < job.maxAttempts) {
          logger.error(
            { exportId, err: error },
            "la generación de portabilidad falló; se reintenta",
          );
          throw error;
        }
        if (code === null)
          logger.error({ exportId, err: error }, "la generación de portabilidad falló");
        try {
          await finishFailed(job, exportId, companyId, code ?? "DATA_EXPORT_FAILED");
        } catch (failure) {
          if (!(failure instanceof LeaseLostError)) throw failure;
        }
      } finally {
        clearInterval(heartbeat);
        if (workDir) await files.removeWork(workDir).catch(() => undefined);
      }
    },
  };
}

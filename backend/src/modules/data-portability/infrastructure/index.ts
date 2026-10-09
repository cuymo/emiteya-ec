// Ensamblado del módulo de portabilidad para main.ts y las pruebas (add-data-portability, design
// D1, D10, D14 y D20). Las fuentes las compone main.ts desde sus módulos dueños: este módulo no lee
// tablas de otros módulos. El arranque prepara el directorio privado, barre antes de iniciar el
// runner y después cada intervalo.
import type { Logger } from "pino";
import type { Registry } from "@prometheus-io/client";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import { createJobRunner } from "../../../platform/jobs/runner.ts";
import { writeXlsx } from "../../../platform/xlsx/xlsx-writer.ts";
import type { PortabilitySources } from "../application/ports.ts";
import { createDataExports } from "../application/service.ts";
import { EXPORT_JOB_TYPE, EXPORT_LEASE_MS, createExportJobHandler } from "./export-job.ts";
import { dataPortabilityRouter } from "./http/data-portability-router.ts";
import { registerPortabilityMetrics } from "./metrics.ts";
import { createPackageFiles, defaultDirectory } from "./package-files.ts";
import { createDataExportStore } from "./prisma-data-exports.ts";
import { createPortabilityDatabase } from "./prisma-portability-database.ts";
import { createPackageSweeper } from "./sweeper.ts";
import { openZip64 } from "./zip64.ts";

export type DataPortabilityLimits = Readonly<{
  directory?: string;
  maxConcurrent: number;
  ttlHours: number;
  headroomPercent: number;
  reserveMib: number;
  sweepIntervalSeconds: number;
}>;

export type DataPortabilityOptions = Readonly<{
  prisma: PrismaClient;
  authorizer: Authorizer;
  sources: PortabilitySources;
  jobs: JobStore;
  limits: DataPortabilityLimits;
  registry: Registry;
  logger: Logger;
  applicationVersion: string;
  /** Solo las pruebas sustituyen la auditoría, para comprobar que nada se entrega si falla. */
  audit?: (db: DbClient) => AuditLog;
  now?: () => Date;
}>;

export function dataPortabilityModule(options: DataPortabilityOptions) {
  const now = options.now ?? (() => new Date());
  const audit = options.audit ?? createAuditLog;
  const database = createPortabilityDatabase(options.prisma);
  const store = createDataExportStore();
  const files = createPackageFiles(options.limits.directory ?? defaultDirectory());
  const metrics = registerPortabilityMetrics(options.registry);
  const handler = createExportJobHandler({
    generator: {
      sources: options.sources,
      writeXlsx,
      openZip: openZip64,
      files: files.files,
      limits: {
        headroomPercent: options.limits.headroomPercent,
        reserveBytes: options.limits.reserveMib * 2 ** 20,
        snapshotTimeoutMs: 5 * 60_000,
      },
      applicationVersion: options.applicationVersion,
      now,
    },
    database,
    store,
    jobs: options.jobs,
    files,
    audit,
    metrics,
    ttlMs: options.limits.ttlHours * 3_600_000,
    logger: options.logger,
    now,
  });
  const runner = createJobRunner({
    store: options.jobs,
    db: options.prisma,
    handlers: { [EXPORT_JOB_TYPE]: handler },
    workers: options.limits.maxConcurrent,
    pollIntervalMs: 2_000,
    leaseMs: EXPORT_LEASE_MS,
    pausedPrefixes: () => [],
    logger: options.logger,
    now,
  });
  const sweeper = createPackageSweeper({
    database,
    store,
    files,
    audit,
    metrics,
    logger: options.logger,
    now,
  });
  const service = createDataExports({
    database,
    repository: store,
    jobs: options.jobs,
    packages: files,
    authorizer: options.authorizer,
    audit,
    observer: metrics,
    now,
  });
  return {
    service,
    files,
    routers: [dataPortabilityRouter(service)],
    /**
     * Prepara el directorio, reconcilia y arranca el runner y el barrido. Si la primera
     * reconciliación falla, el runner arranca igual: un intento nuevo nunca usa los archivos de
     * otro, y el barrido periódico reconcilia después.
     */
    async start() {
      await files.init();
      await sweeper
        .sweep()
        .catch((error: unknown) =>
          options.logger.error({ err: error }, "el barrido inicial de la portabilidad falló"),
        );
      runner.start();
      sweeper.start(options.limits.sweepIntervalSeconds * 1_000);
    },
    async close() {
      sweeper.stop();
      await runner.close();
    },
  };
}

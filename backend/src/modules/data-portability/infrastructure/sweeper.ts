// Barrido y recuperación de la portabilidad (add-data-portability, design D14 y D15). Al arrancar,
// antes del runner, y cada intervalo:
// 1. un paquete listo vencido caduca (`TTL`) y se borra;
// 2. uno listo y vigente cuyo archivo falta o no tiene su tamaño queda `FAILED`
//    (`DATA_EXPORT_PACKAGE_MISSING` o `DATA_EXPORT_PACKAGE_INTEGRITY`), nunca `EXPIRED`;
// 3. se borra lo que no pertenece a un paquete listo ni al intento de una generación en curso:
//    parciales, trabajos y paquetes huérfanos o de intentos obsoletos.
// Solo toca nombres de la gramática de la portabilidad, sin seguir enlaces, y nunca un dato ni un
// artefacto de la empresa. El SHA-256 completo lo comprueba la descarga, porque es caro.
import type { DataExportFailureCode } from "@facturador/contracts";
import type { Logger } from "pino";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { PortabilityDatabase } from "../application/ports.ts";
import type { PortabilityMetrics } from "./metrics.ts";
import type { PackageFiles } from "./package-files.ts";
import type { DataExportStore } from "./prisma-data-exports.ts";

export type SweeperDeps = Readonly<{
  database: PortabilityDatabase;
  store: DataExportStore;
  files: PackageFiles;
  audit: (db: DbClient) => AuditLog;
  metrics: PortabilityMetrics;
  logger: Pick<Logger, "info" | "warn" | "error">;
  now: () => Date;
}>;

export type SweepResult = Readonly<{ expired: number; failed: number; removed: number }>;

export function createPackageSweeper(deps: SweeperDeps) {
  const { database, store, files, metrics, logger } = deps;

  /** Un paquete listo perdido o alterado antes de caducar: `FAILED` con su código y su evento. */
  async function failReady(id: string, companyId: string, code: DataExportFailureCode) {
    return database.transaction(async (tx) => {
      const changed = await store.fail(tx, { id, code, now: deps.now(), from: "READY" });
      if (changed) {
        await deps.audit(tx).append({
          companyId,
          actor: { type: "SYSTEM" },
          action: "data_export.failed",
          changes: { exportId: id, code },
          correlationId: `sweep:${id}`,
        });
      }
      return changed;
    });
  }

  async function sweep(): Promise<SweepResult> {
    let expired = 0;
    let failed = 0;
    let removed = 0;
    const now = deps.now();
    const keepPackages = new Set<string>();
    const keepAttempts = new Set<string>();
    for (const row of await store.sweepable(database.db)) {
      if (row.status === "GENERATING") {
        // Su intento sigue: su trabajo, su parcial y el paquete que esté publicando.
        keepAttempts.add(`${row.id}-${row.attempt}`);
        continue;
      }
      if (!row.fileName || !row.expiresAt || row.sizeBytes === null) continue;
      if (row.expiresAt <= now) {
        if (await database.transaction((tx) => store.expire(tx, { id: row.id, now }))) {
          expired += 1;
          metrics.expired();
        }
        continue;
      }
      const size = await files.packageSize(row.fileName);
      if (size === null || BigInt(size) !== row.sizeBytes) {
        const code =
          size === null ? "DATA_EXPORT_PACKAGE_MISSING" : "DATA_EXPORT_PACKAGE_INTEGRITY";
        if (await failReady(row.id, row.companyId, code)) {
          failed += 1;
          metrics.failed(code);
          logger.error({ exportId: row.id, code }, "paquete de portabilidad perdido o alterado");
        }
        continue;
      }
      keepPackages.add(row.fileName);
    }
    for (const entry of await files.list()) {
      const attempt = `${entry.exportId}-${entry.attempt}`;
      const keep =
        keepAttempts.has(attempt) || (entry.kind === "zip" && keepPackages.has(entry.name));
      if (keep) continue;
      await files.removeEntry(entry);
      removed += 1;
    }
    if (expired + failed + removed > 0) {
      logger.info({ expired, failed, removed }, "barrido de la portabilidad");
    }
    return { expired, failed, removed };
  }

  let timer: NodeJS.Timeout | undefined;
  let running: Promise<SweepResult> | undefined;
  const once = () => {
    running ??= sweep().finally(() => {
      running = undefined;
    });
    return running;
  };
  return {
    sweep: once,
    start(intervalMs: number) {
      timer = setInterval(() => {
        once().catch((error: unknown) =>
          logger.error({ err: error }, "el barrido de la portabilidad falló"),
        );
      }, intervalMs);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
    },
  };
}

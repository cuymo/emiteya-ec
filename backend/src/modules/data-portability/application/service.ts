// Casos de uso de la API de portabilidad (add-data-portability, design D10, D16, D17, D18 y D19),
// solo para quien tiene `dataPortability.export`, con la empresa siempre de la sesión.
// - Solicitar: la fila `QUEUED`, el job y `data_export.requested` en una sola transacción; una
//   generación activa de la empresa responde `409` sin segundo efecto.
// - Descargar: el estado y la vigencia; el tamaño y el SHA-256 completos del paquete, sobre el mismo
//   descriptor y antes de cualquier cabecera; `data_export.download_started` antes del primer byte.
//   Un paquete listo perdido o alterado queda `FAILED` y nunca se entrega. Si el cliente se
//   desconecta durante la verificación, se abandona sin registrar una descarga que no empezó.
import type { FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  createDataExportSchema,
  dataExportIdParamsSchema,
  listDataExportsQuerySchema,
  type DataExportCounts,
  type DataExportFailureCode,
  type DataExportView,
} from "@facturador/contracts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { NewJob } from "../../../platform/jobs/jobs.ts";
import { packageFileName } from "../domain/format.ts";
import {
  DownloadAbortedError,
  DataExportExpiredError,
  DataExportNotFoundError,
  DataExportNotReadyError,
  DataExportPackageError,
} from "./errors.ts";
import type { PortabilityDatabase } from "./ports.ts";

export const EXPORT_JOB = "portability.export";
const EXPORT_JOB_ATTEMPTS = 3;

/** Lo que la API lee de una exportación: nunca el nombre interno del archivo sale de aquí. */
export type DataExportRecordView = Readonly<{
  id: string;
  companyId: string;
  status: string;
  phase: string | null;
  progressDone: number | null;
  progressTotal: number | null;
  requestedAt: Date;
  startedAt: Date | null;
  snapshotAt: Date | null;
  generatedAt: Date | null;
  expiresAt: Date | null;
  finishedAt: Date | null;
  fileName: string | null;
  sizeBytes: bigint | null;
  sha256: string | null;
  formatVersion: string;
  counts: unknown;
  errorCode: string | null;
  expiredReason: string | null;
  requester: Readonly<{ name: string }>;
}>;

export type DataExportsRepository = Readonly<{
  create(
    tx: DbClient,
    input: Readonly<{ companyId: string; requestedBy: string }>,
  ): Promise<DataExportRecordView>;
  find(db: DbClient, companyId: string, id: string): Promise<DataExportRecordView | null>;
  list(
    db: DbClient,
    companyId: string,
    page: Readonly<{ page: number; pageSize: number }>,
  ): Promise<Readonly<{ rows: DataExportRecordView[]; total: number }>>;
  fail(
    tx: DbClient,
    input: Readonly<{ id: string; code: DataExportFailureCode; now: Date; from: "READY" }>,
  ): Promise<boolean>;
}>;

export type DownloadObserver = Readonly<{
  download(result: "started" | "not_ready" | "expired" | "integrity_failed" | "aborted"): void;
  failed(code: string): void;
}>;

export type DataExportsDeps = Readonly<{
  database: PortabilityDatabase;
  repository: DataExportsRepository;
  jobs: Readonly<{ enqueueIn(db: DbClient, job: NewJob): Promise<boolean> }>;
  packages: Readonly<{ openPackage(fileName: string): Promise<FileHandle | null> }>;
  authorizer: Authorizer;
  audit: (db: DbClient) => AuditLog;
  observer: DownloadObserver;
  now?: () => Date;
}>;

const iso = (moment: Date | null) => (moment === null ? null : moment.toISOString());

export function toView(row: DataExportRecordView): DataExportView {
  const progress =
    row.progressDone !== null && row.progressTotal !== null
      ? { done: row.progressDone, total: row.progressTotal }
      : null;
  return {
    id: row.id,
    status: row.status as DataExportView["status"],
    phase: row.phase as DataExportView["phase"],
    progress,
    requestedBy: { name: row.requester.name },
    requestedAt: row.requestedAt.toISOString(),
    startedAt: iso(row.startedAt),
    snapshotAt: iso(row.snapshotAt),
    generatedAt: iso(row.generatedAt),
    expiresAt: iso(row.expiresAt),
    finishedAt: iso(row.finishedAt),
    sizeBytes: row.sizeBytes === null ? null : row.sizeBytes.toString(),
    sha256: row.sha256,
    formatVersion: "1",
    counts: (row.counts as DataExportCounts | null) ?? null,
    errorCode: row.errorCode as DataExportView["errorCode"],
    expiredReason: row.expiredReason as DataExportView["expiredReason"],
  };
}

async function hashOf(handle: FileHandle, signal: AbortSignal | undefined): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of handle.createReadStream({
    start: 0,
    autoClose: false,
    highWaterMark: 1 << 20,
  })) {
    if (signal?.aborted) throw new DownloadAbortedError();
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export type DownloadablePackage = Readonly<{
  handle: FileHandle;
  sizeBytes: number;
  fileName: string;
}>;

export function createDataExports(deps: DataExportsDeps) {
  const { database, repository, authorizer, observer } = deps;
  const now = deps.now ?? (() => new Date());
  const permission = "dataPortability.export" as const;

  async function find(ctx: RequestContext, id: string) {
    const row = await repository.find(database.db, ctx.companyId, id);
    if (!row) throw new DataExportNotFoundError();
    return row;
  }

  /** Un paquete listo que se perdió o se alteró: `FAILED` con su código y su evento, nunca entregado. */
  async function failReady(
    row: DataExportRecordView,
    code: "DATA_EXPORT_PACKAGE_MISSING" | "DATA_EXPORT_PACKAGE_INTEGRITY",
  ): Promise<never> {
    const changed = await database.transaction(async (tx) => {
      const failed = await repository.fail(tx, { id: row.id, code, now: now(), from: "READY" });
      if (failed) {
        await deps.audit(tx).append({
          companyId: row.companyId,
          actor: { type: "SYSTEM" },
          action: "data_export.failed",
          changes: { exportId: row.id, code },
          correlationId: `download:${row.id}`,
        });
      }
      return failed;
    });
    if (changed) observer.failed(code);
    observer.download("integrity_failed");
    throw new DataExportPackageError(code);
  }

  return {
    async request(ctx: RequestContext, body: unknown): Promise<DataExportView> {
      authorizer.requirePermission(ctx, permission);
      parseInput(createDataExportSchema, body ?? {});
      const row = await database.transaction(async (tx) => {
        const created = await repository.create(tx, {
          companyId: ctx.companyId,
          requestedBy: ctx.userId,
        });
        await deps.jobs.enqueueIn(tx, {
          companyId: ctx.companyId,
          type: EXPORT_JOB,
          dedupeKey: `${EXPORT_JOB}:${created.id}`,
          payload: { exportId: created.id },
          runAt: now(),
          maxAttempts: EXPORT_JOB_ATTEMPTS,
          origin: "MANUAL",
          requestedBy: ctx.userId,
        });
        await deps.audit(tx).append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "data_export.requested",
          changes: { exportId: created.id },
          correlationId: ctx.requestId,
        });
        return created;
      });
      return toView(row);
    },

    async list(ctx: RequestContext, query: unknown) {
      authorizer.requirePermission(ctx, permission);
      const page = parseInput(listDataExportsQuerySchema, query);
      const { rows, total } = await repository.list(database.db, ctx.companyId, page);
      return { data: rows.map(toView), meta: { ...page, total } };
    },

    async detail(ctx: RequestContext, params: unknown): Promise<DataExportView> {
      authorizer.requirePermission(ctx, permission);
      const { id } = parseInput(dataExportIdParamsSchema, params);
      return toView(await find(ctx, id));
    },

    /**
     * Verifica el paquete completo y registra el inicio de la descarga; el llamador envía el cuerpo
     * desde el descriptor devuelto y lo cierra. Nada se envía si algo de esto falla. `signal` se
     * aborta cuando el cliente se desconecta: la verificación se abandona sin registrar nada.
     */
    async download(
      ctx: RequestContext,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<DownloadablePackage> {
      authorizer.requirePermission(ctx, permission);
      const { id } = parseInput(dataExportIdParamsSchema, params);
      const row = await find(ctx, id);
      if (row.status === "EXPIRED" || (row.status === "READY" && row.expiresAt! <= now())) {
        observer.download("expired");
        throw new DataExportExpiredError();
      }
      if (row.status !== "READY") {
        observer.download("not_ready");
        throw new DataExportNotReadyError();
      }
      const handle = await deps.packages.openPackage(row.fileName!);
      if (!handle) return failReady(row, "DATA_EXPORT_PACKAGE_MISSING");
      try {
        const { size } = await handle.stat();
        if (BigInt(size) !== row.sizeBytes)
          return await failReady(row, "DATA_EXPORT_PACKAGE_INTEGRITY");
        if ((await hashOf(handle, signal)) !== row.sha256) {
          return await failReady(row, "DATA_EXPORT_PACKAGE_INTEGRITY");
        }
        if (signal?.aborted) throw new DownloadAbortedError();
        await deps.audit(database.db).append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "data_export.download_started",
          changes: { exportId: row.id },
          correlationId: ctx.requestId,
        });
        observer.download("started");
        return { handle, sizeBytes: size, fileName: packageFileName(row.generatedAt!) };
      } catch (error) {
        await handle.close();
        if (error instanceof DownloadAbortedError) observer.download("aborted");
        throw error;
      }
    },
  };
}

export type DataExports = ReturnType<typeof createDataExports>;

// Registro de las exportaciones sobre Prisma (add-data-portability, design D10 y D15). Cada
// transición va guardada por el estado de origen y, durante la generación, por el intento: una
// escritura de otro intento o de otro estado no tiene efecto. La base fija además los estados, sus
// campos y las transiciones (CHECK y trigger de la migración).
import type {
  DataExportCounts,
  DataExportFailureCode,
  DataExportPhase,
} from "@facturador/contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { DataExportInProgressError } from "../application/errors.ts";

export type DataExportRecord = Prisma.DataExportGetPayload<{
  include: { requester: { select: { name: true } } };
}>;

const withRequester = { requester: { select: { name: true } } } as const;

export function createDataExportStore() {
  return {
    /** La solicitud: `QUEUED`, con la empresa en la columna de la generación activa. */
    async create(tx: DbClient, input: Readonly<{ companyId: string; requestedBy: string }>) {
      try {
        return await tx.dataExport.create({
          data: {
            companyId: input.companyId,
            requestedBy: input.requestedBy,
            status: "QUEUED",
            activeCompanyId: input.companyId,
          },
          include: withRequester,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new DataExportInProgressError();
        }
        throw error;
      }
    },

    find(db: DbClient, companyId: string, id: string) {
      return db.dataExport.findFirst({ where: { companyId, id }, include: withRequester });
    },

    findById(db: DbClient, id: string) {
      return db.dataExport.findUnique({ where: { id }, include: withRequester });
    },

    async list(
      db: DbClient,
      companyId: string,
      page: Readonly<{ page: number; pageSize: number }>,
    ) {
      const [rows, total] = await Promise.all([
        db.dataExport.findMany({
          where: { companyId },
          orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
          include: withRequester,
        }),
        db.dataExport.count({ where: { companyId } }),
      ]);
      return { rows, total };
    },

    /** El intento toma la exportación: `GENERATING` con su intento; null si ya no está activa. */
    async start(tx: DbClient, input: Readonly<{ id: string; attempt: number; now: Date }>) {
      const row = await tx.dataExport.findUnique({ where: { id: input.id } });
      if (!row || (row.status !== "QUEUED" && row.status !== "GENERATING")) return null;
      return tx.dataExport.update({
        where: { id: input.id },
        data: {
          status: "GENERATING",
          attempt: input.attempt,
          startedAt: row.startedAt ?? input.now,
          phase: "SNAPSHOT",
          progressDone: null,
          progressTotal: null,
        },
        include: withRequester,
      });
    },

    /** La fase y el progreso del intento en curso; sin efecto para otro intento. */
    async progress(
      db: DbClient,
      input: Readonly<{
        id: string;
        attempt: number;
        phase: DataExportPhase;
        done?: number;
        total?: number;
      }>,
    ) {
      const known = input.done !== undefined && input.total !== undefined;
      await db.dataExport.updateMany({
        where: { id: input.id, status: "GENERATING", attempt: input.attempt },
        data: {
          phase: input.phase,
          progressDone: known ? input.done : null,
          progressTotal: known ? input.total : null,
        },
      });
    },

    /**
     * Publica el paquete del intento (design D11 y D15): en la misma transacción, el paquete
     * vigente anterior de la empresa caduca por reemplazo y este queda `READY`, con su caducidad
     * contada desde ahora. Devuelve el archivo del anterior para borrarlo después del commit.
     */
    async publish(
      tx: DbClient,
      input: Readonly<{
        id: string;
        companyId: string;
        attempt: number;
        now: Date;
        ttlMs: number;
        snapshotAt: Date;
        fileName: string;
        sizeBytes: number;
        sha256: string;
        counts: DataExportCounts;
      }>,
    ): Promise<string | null> {
      const previous = await tx.dataExport.findFirst({
        where: { companyId: input.companyId, status: "READY", NOT: { id: input.id } },
      });
      if (previous) {
        await tx.dataExport.update({
          where: { id: previous.id },
          data: {
            status: "EXPIRED",
            readyCompanyId: null,
            expiredReason: "REPLACED",
            finishedAt: input.now,
          },
        });
      }
      const { count } = await tx.dataExport.updateMany({
        where: { id: input.id, status: "GENERATING", attempt: input.attempt },
        data: {
          status: "READY",
          activeCompanyId: null,
          readyCompanyId: input.companyId,
          phase: null,
          progressDone: null,
          progressTotal: null,
          snapshotAt: input.snapshotAt,
          generatedAt: input.now,
          expiresAt: new Date(input.now.getTime() + input.ttlMs),
          fileName: input.fileName,
          sizeBytes: BigInt(input.sizeBytes),
          sha256: input.sha256,
          counts: input.counts,
        },
      });
      if (count !== 1) throw new Error("la exportación ya no está en generación con este intento");
      return previous?.fileName ?? null;
    },

    /**
     * `FAILED` con su código seguro. Desde la generación (guardada por el intento) o desde un
     * paquete listo que se perdió o se alteró antes de caducar. Devuelve si cambió la fila.
     */
    async fail(
      tx: DbClient,
      input: Readonly<{
        id: string;
        code: DataExportFailureCode;
        now: Date;
        from: "GENERATING" | "READY";
        attempt?: number;
      }>,
    ): Promise<boolean> {
      const { count } = await tx.dataExport.updateMany({
        where: {
          id: input.id,
          ...(input.from === "GENERATING"
            ? {
                status: { in: ["QUEUED", "GENERATING"] },
                ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
              }
            : { status: "READY" }),
        },
        data: {
          status: "FAILED",
          activeCompanyId: null,
          readyCompanyId: null,
          phase: null,
          progressDone: null,
          progressTotal: null,
          errorCode: input.code,
          finishedAt: input.now,
        },
      });
      return count === 1;
    },

    /** `READY` → `EXPIRED` por vencimiento. Devuelve si cambió la fila. */
    async expire(tx: DbClient, input: Readonly<{ id: string; now: Date }>): Promise<boolean> {
      const { count } = await tx.dataExport.updateMany({
        where: { id: input.id, status: "READY" },
        data: {
          status: "EXPIRED",
          readyCompanyId: null,
          expiredReason: "TTL",
          finishedAt: input.now,
        },
      });
      return count === 1;
    },

    /** Para el barrido: las exportaciones listas y las que se generan, de todas las empresas. */
    async sweepable(db: DbClient) {
      const rows = await db.dataExport.findMany({
        where: { status: { in: ["READY", "GENERATING"] } },
        select: {
          id: true,
          companyId: true,
          status: true,
          attempt: true,
          fileName: true,
          sizeBytes: true,
          expiresAt: true,
        },
      });
      return rows;
    },
  };
}

export type DataExportStore = ReturnType<typeof createDataExportStore>;

// Barrido idempotente del RIDE (add-document-archive, design D5): al arrancar y cada
// `RIDE_SWEEP_INTERVAL_SECONDS`, encola `document.render_ride` para cada comprobante `AUTHORIZED`
// sin `RIDE_PDF` ni ningún job del RIDE. Es el backfill de los autorizados anteriores al despliegue
// y la defensa secundaria del seguidor de la autorización, nunca el camino normal. No reactiva un
// job `STOPPED`: eso es el reintento explícito de un usuario.
import type { PrismaClient } from "../../../../generated/prisma/client.ts";
import type { JobStore } from "../../../../platform/jobs/jobs.ts";
import {
  RIDE_JOB_TYPE,
  rideJob,
  type RideJobSettings,
} from "../../application/archive/ride-jobs.ts";

export type RideSweeper = {
  /** Una pasada completa; devuelve cuántos jobs creó. */
  sweep(): Promise<number>;
  start(intervalMs: number): void;
  close(): Promise<void>;
};

const BATCH = 200;

export function createRideSweeper(deps: {
  prisma: PrismaClient;
  jobs: Pick<JobStore, "enqueueIn">;
  settings: RideJobSettings;
  logger: {
    info(details: object, message: string): void;
    error(details: object, message: string): void;
  };
  now?: () => Date;
}): RideSweeper {
  const now = deps.now ?? (() => new Date());
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<number> | undefined;

  async function sweepOnce(): Promise<number> {
    let created = 0;
    let after: string | undefined;
    for (;;) {
      const documents = await deps.prisma.electronicDocument.findMany({
        where: {
          state: "AUTHORIZED",
          artifacts: { none: { kind: "RIDE_PDF" } },
          jobs: { none: { type: RIDE_JOB_TYPE } },
          ...(after ? { id: { gt: after } } : {}),
        },
        select: { id: true, companyId: true },
        orderBy: { id: "asc" },
        take: BATCH,
      });
      for (const document of documents) {
        // ON CONFLICT DO NOTHING sobre la clave activa: otro barrido o la autorización pudieron
        // crearlo entre tanto.
        if (await deps.jobs.enqueueIn(deps.prisma, rideJob(document, deps.settings, now()))) {
          created++;
        }
      }
      if (documents.length < BATCH) return created;
      after = documents.at(-1)!.id;
    }
  }

  const sweep = () => {
    running ??= sweepOnce().finally(() => {
      running = undefined;
    });
    return running;
  };

  return {
    sweep,
    start(intervalMs) {
      timer = setInterval(() => {
        sweep().then(
          (created) => {
            if (created > 0) deps.logger.info({ created }, "barrido del RIDE");
          },
          (error: unknown) => deps.logger.error({ err: error }, "el barrido del RIDE falló"),
        );
      }, intervalMs);
      timer.unref();
    },
    async close() {
      clearInterval(timer);
      await running?.catch(() => {});
    },
  };
}

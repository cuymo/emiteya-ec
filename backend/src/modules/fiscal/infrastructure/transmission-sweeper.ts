// Barrido idempotente de la transmisión (add-sri-transmission, design D6): al arrancar y cada
// `SRI_SWEEP_INTERVAL_SECONDS`, inserta un `sri.transmit` para cada comprobante `SIGNED` sin ningún
// job del SRI. Es el backfill de los firmados que existan al desplegar y la red de seguridad del
// encolado al firmar. No reactiva un job `STOPPED`: eso es una decisión humana (design D15). Corre
// también con la transmisión deshabilitada, que solo pausa los workers.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import { enqueueTransmissionIn } from "../application/transmission-jobs.ts";
import type { TransmissionSettings } from "../application/transmission-settings.ts";

export type TransmissionSweeper = {
  /** Una pasada completa; devuelve cuántos jobs creó. */
  sweep(): Promise<number>;
  start(intervalMs: number): void;
  close(): Promise<void>;
};

const BATCH = 200;

export function createTransmissionSweeper(deps: {
  prisma: PrismaClient;
  jobs: Pick<JobStore, "enqueueIn">;
  settings: TransmissionSettings;
  logger: {
    info(details: object, message: string): void;
    error(details: object, message: string): void;
  };
  now?: () => Date;
}): TransmissionSweeper {
  const now = deps.now ?? (() => new Date());
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<number> | undefined;

  async function sweepOnce(): Promise<number> {
    let created = 0;
    let after: string | undefined;
    for (;;) {
      const documents = await deps.prisma.electronicDocument.findMany({
        where: {
          state: "SIGNED",
          jobs: { none: { type: { startsWith: "sri." } } },
          ...(after ? { id: { gt: after } } : {}),
        },
        select: { id: true, companyId: true },
        orderBy: { id: "asc" },
        take: BATCH,
      });
      for (const document of documents) {
        // ON CONFLICT DO NOTHING: otro barrido o la firma pudieron crearlo entre tanto.
        if (
          await enqueueTransmissionIn(
            { db: deps.prisma, jobs: deps.jobs },
            document,
            deps.settings,
            now(),
          )
        ) {
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
            if (created > 0) deps.logger.info({ created }, "barrido de la transmisión");
          },
          (error: unknown) =>
            deps.logger.error({ err: error }, "el barrido de la transmisión falló"),
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

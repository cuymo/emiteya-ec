// Unidad de trabajo de los borradores (add-invoice-emission, design D2): el borrador, sus líneas y
// sus pagos en una transacción. Los borradores no se auditan (design D14).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DraftsUnitOfWork } from "../application/ports.ts";
import { createDraftRepository } from "./prisma-drafts.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

export function createDraftsUnitOfWork(prisma: PrismaClient): DraftsUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work({ drafts: createDraftRepository(tx) }), {
        timeout: TRANSACTION_TIMEOUT_MS,
      }),
  };
}

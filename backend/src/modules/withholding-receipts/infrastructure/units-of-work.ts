// Unidades de trabajo de los comprobantes de retención (add-withholding-receipts, design D15): los
// borradores, y la transacción de `RESERVED` de la emisión.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { WithholdingDraftsUnitOfWork } from "../application/ports.ts";
import { createWithholdingDraftRepository } from "./prisma-drafts.ts";

export function createWithholdingDraftsUnitOfWork(
  prisma: PrismaClient,
): WithholdingDraftsUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work({ drafts: createWithholdingDraftRepository(tx) })),
  };
}

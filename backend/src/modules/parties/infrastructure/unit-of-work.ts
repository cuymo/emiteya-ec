// Unidad de trabajo de terceros (add-parties-and-products, design D13): el cambio y su evento de
// auditoría en la misma transacción.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { PartiesUnitOfWork } from "../application/ports.ts";
import { createPartyRepository } from "./prisma-parties.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

export function createPartiesUnitOfWork(prisma: PrismaClient): PartiesUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction(
        (tx) => work({ parties: createPartyRepository(tx), audit: createAuditLog(tx) }),
        { timeout: TRANSACTION_TIMEOUT_MS },
      ),
  };
}

// Transacción que guarda el RIDE y completa su job (add-document-archive, design D5).
import type { PrismaClient } from "../../../../generated/prisma/client.ts";
import type { RideUnitOfWork } from "../../application/archive/ride-ports.ts";
import { createArtifactStore } from "../prisma-artifacts.ts";

export function createRideUnitOfWork(prisma: PrismaClient): RideUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work({ db: tx, artifacts: createArtifactStore(tx) })),
  };
}

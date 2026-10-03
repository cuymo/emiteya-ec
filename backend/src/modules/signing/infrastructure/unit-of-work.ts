// Unidad de trabajo de la firma (design D7): repositorio y auditoría en la misma transacción.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { SigningUnitOfWork } from "../application/ports.ts";
import { createCertificateRepository } from "./prisma-certificates.ts";

export function createSigningUnitOfWork(prisma: PrismaClient): SigningUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) =>
        work({ certificates: createCertificateRepository(tx), audit: createAuditLog(tx) }),
      ),
  };
}

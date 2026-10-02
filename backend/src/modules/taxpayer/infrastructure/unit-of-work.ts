// Unidad de trabajo del módulo taxpayer (design D1): una transacción interactiva de Prisma con los
// repositorios y la auditoría ligados a ella. No usa Better Auth.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { TaxpayerUnitOfWork } from "../application/ports.ts";
import { createCompanyConfigRepository } from "./prisma-company-config.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

export function createTaxpayerUnitOfWork(prisma: PrismaClient): TaxpayerUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction(
        (tx) =>
          work({
            configs: createCompanyConfigRepository(tx),
            audit: createAuditLog(tx),
            lockConfiguration: async (companyId) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`company-config:${companyId}`}))`;
            },
          }),
        { timeout: TRANSACTION_TIMEOUT_MS },
      ),
  };
}

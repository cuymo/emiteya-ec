// Unidad de trabajo del módulo taxpayer (design D1): una transacción interactiva de Prisma con los
// repositorios y la auditoría ligados a ella. No usa Better Auth.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { TaxpayerScope, TaxpayerUnitOfWork } from "../application/ports.ts";
import { createCompanyConfigRepository } from "./prisma-company-config.ts";
import { createConfigurationAssetStore } from "./prisma-configuration-assets.ts";
import { createEstablishmentRepository } from "./prisma-establishments.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

/**
 * Repositorios y lock de la configuración sobre un cliente. Dentro de una transacción ajena, la
 * emisión de facturas lo usa para bloquear la identidad tributaria (add-invoice-emission, D1 y D7).
 */
export function createTaxpayerScope(db: DbClient): TaxpayerScope {
  return {
    configs: createCompanyConfigRepository(db),
    assets: createConfigurationAssetStore(db),
    establishments: createEstablishmentRepository(db),
    audit: createAuditLog(db),
    lockConfiguration: async (companyId) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`company-config:${companyId}`}))`;
    },
  };
}

/** Lecturas de la emisión de facturas dentro de su transacción (add-invoice-emission, design D1). */
export function taxpayerEmissionReads(db: DbClient) {
  const configs = createCompanyConfigRepository(db);
  const establishments = createEstablishmentRepository(db);
  return {
    /** Configuración vigente, o null si la empresa no la registró. */
    currentConfig: (companyId: string) => configs.findCurrent(companyId),
    /** Punto de la empresa con su establecimiento, o null si no existe en ella. */
    emissionPoint: (companyId: string, emissionPointId: string) =>
      establishments.findPointWithEstablishment(companyId, emissionPointId),
  };
}

export function createTaxpayerUnitOfWork(prisma: PrismaClient): TaxpayerUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work(createTaxpayerScope(tx)), {
        timeout: TRANSACTION_TIMEOUT_MS,
      }),
  };
}

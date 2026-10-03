// Unidades de trabajo de los catálogos fiscales (add-fiscal-catalogs, design D3 y D9).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { CatalogsUnitOfWork, DatasetUnitOfWork } from "../application/ports.ts";
import {
  createCatalogReader,
  createDatasetStore,
  createEnablementRepository,
} from "./prisma-catalogs.ts";

/**
 * Transacción del cargador. El tiempo máximo cubre la espera del lock por otra instancia que esté
 * aplicando los datasets: la perdedora espera y después reconoce lo aplicado.
 */
export function createDatasetUnitOfWork(prisma: PrismaClient): DatasetUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work(createDatasetStore(tx)), {
        maxWait: 30_000,
        timeout: 120_000,
      }),
  };
}

export function createCatalogsUnitOfWork(prisma: PrismaClient): CatalogsUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) =>
        work({
          enablement: createEnablementRepository(tx),
          reader: createCatalogReader(tx),
          audit: createAuditLog(tx),
        }),
      ),
  };
}

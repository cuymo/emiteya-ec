// Composición del módulo de catálogos fiscales para main.ts y las pruebas (add-fiscal-catalogs,
// design D1, D3 y D11).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { loadFiscalCatalogs, type LoadReport } from "../application/dataset-loader.ts";
import { createFiscalCatalogs } from "../application/fiscal-catalogs.ts";
import { createCatalogResolver } from "../application/resolver.ts";
import { DATASET_FILES } from "../datasets/index.ts";
import { validateDatasets } from "../domain/datasets.ts";
import { fiscalCatalogsRouter } from "./http/fiscal-catalogs-router.ts";
import { createCatalogReader, createEnablementRepository } from "./prisma-catalogs.ts";
import { createCatalogsUnitOfWork, createDatasetUnitOfWork } from "./unit-of-work.ts";

/**
 * Valida los datasets de la versión instalada y aplica los pendientes. Se llama al arrancar,
 * después del aprovisionamiento; un dataset inválido o en conflicto impide arrancar.
 */
export async function loadInstalledFiscalCatalogs(
  prisma: PrismaClient,
  files: readonly unknown[] = DATASET_FILES,
): Promise<LoadReport> {
  const datasets = validateDatasets(files);
  return loadFiscalCatalogs({ uow: createDatasetUnitOfWork(prisma), datasets });
}

export type CatalogsModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  now?: () => Date;
};

export function catalogsModule(options: CatalogsModuleOptions) {
  const reader = createCatalogReader(options.prisma);
  const service = createFiscalCatalogs({
    reader,
    enablement: createEnablementRepository(options.prisma),
    uow: createCatalogsUnitOfWork(options.prisma),
    authorizer: options.authorizer,
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    routers: [fiscalCatalogsRouter(service)],
    service,
    /** La única resolución de vigencia que usarán terceros, productos y emisión (design D5). */
    resolver: createCatalogResolver(reader),
  };
}

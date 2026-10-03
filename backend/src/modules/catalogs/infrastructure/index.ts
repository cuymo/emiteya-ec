// Composición del módulo de catálogos fiscales (add-fiscal-catalogs, design D1 y D3).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { loadFiscalCatalogs, type LoadReport } from "../application/dataset-loader.ts";
import { DATASET_FILES } from "../datasets/index.ts";
import { validateDatasets } from "../domain/datasets.ts";
import { createDatasetUnitOfWork } from "./unit-of-work.ts";

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

// POLÍTICA SINTÉTICA DE PRUEBAS del límite de tamaño del envío al SRI (add-sri-transmission,
// design D17). No es la cifra oficial: Q-47 sigue abierta hasta verificar la fuente. La cifra por
// defecto es deliberadamente ajena a cualquier interpretación de "320 KB", y la fuente apunta a un
// dominio `.invalid`, para que nunca se confunda con un dato normativo.
import { loadFiscalCatalogs } from "../../src/modules/catalogs/application/dataset-loader.ts";
import {
  validateDatasets,
  type SriTransmissionPolicyDataset,
} from "../../src/modules/catalogs/domain/datasets.ts";
import { createDatasetUnitOfWork } from "../../src/modules/catalogs/infrastructure/unit-of-work.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";

export const SYNTHETIC_POLICY_BYTES = 4_096;

export function syntheticSizePolicy(
  overrides: Partial<SriTransmissionPolicyDataset["versions"][number]> = {},
  version = 1,
): SriTransmissionPolicyDataset {
  return {
    catalogType: "sri-transmission-policy",
    version,
    source: {
      document: "POLÍTICA SINTÉTICA DE PRUEBAS: no es la cifra oficial (Q-47)",
      version: "sintética",
      publishedOn: "2026-07-27",
      url: "https://politica-sintetica.invalid/limite-de-tamano",
      sha256: "0".repeat(64),
    },
    enablementPolicy: "NOT_ENABLEABLE",
    versions: [
      {
        maxSignedDocumentBytes: SYNTHETIC_POLICY_BYTES,
        sourceText: "Texto sintético de pruebas: no cita ninguna fuente oficial.",
        sourceSection: "Sección sintética",
        literalUnit: "bytes (sintético)",
        interpretation: "Cifra sintética de pruebas, sin interpretación oficial.",
        effectiveFrom: "2026-07-27",
        effectiveFromBasis: "PROJECT_BASELINE",
        effectiveTo: null,
        ...overrides,
      },
    ],
  };
}

/** Aplica la política sintética con el cargador real, como si fuera un dataset del repositorio. */
export async function installSyntheticSizePolicy(
  prisma: PrismaClient,
  datasets: readonly SriTransmissionPolicyDataset[] = [syntheticSizePolicy()],
) {
  return loadFiscalCatalogs({
    uow: createDatasetUnitOfWork(prisma),
    datasets: validateDatasets(datasets),
  });
}

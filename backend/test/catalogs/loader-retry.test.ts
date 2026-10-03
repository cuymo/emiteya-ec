// Respaldo sin lock (add-fiscal-catalogs, design D3, paso 6): una violación de unicidad por una carga
// concurrente se reintenta una vez y el reintento reconoce lo aplicado.
import { describe, expect, it } from "vitest";
import {
  isUniqueViolation,
  loadFiscalCatalogs,
} from "../../src/modules/catalogs/application/dataset-loader.ts";
import type {
  DatasetStore,
  DatasetUnitOfWork,
} from "../../src/modules/catalogs/application/ports.ts";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import { validateDatasets } from "../../src/modules/catalogs/domain/datasets.ts";

describe("reintento ante una violación de unicidad", () => {
  const datasets = validateDatasets(DATASET_FILES);
  const applied = datasets.map((d) => ({
    catalogType: d.catalogType,
    version: d.version,
    checksum: d.checksum,
    sourceDocument: d.source.document,
    sourceVersion: d.source.version,
    sourcePublishedOn: d.source.publishedOn,
    sourceUrl: d.source.url,
    sourceSha256: d.source.sha256,
    enablementPolicy: d.enablementPolicy,
  }));

  it("reconoce los códigos de Prisma y de PostgreSQL", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation(new Error("otra cosa"))).toBe(false);
  });

  it("el primer intento choca con otra carga; el segundo encuentra todo aplicado", async () => {
    let attempts = 0;
    const uow: DatasetUnitOfWork = {
      run: (work) => {
        attempts++;
        const store = {
          lockLoader: () => Promise.resolve(),
          appliedDatasets: () => Promise.resolve(attempts === 1 ? [] : applied),
          insertDataset: () =>
            attempts === 1
              ? Promise.reject(
                  Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
                )
              : Promise.resolve(),
        } as unknown as DatasetStore;
        return work(store);
      },
    };
    const report = await loadFiscalCatalogs({ uow, datasets });
    expect(attempts).toBe(2);
    expect(report.applied).toEqual([]);
    expect(report.alreadyApplied).toHaveLength(9);
  });

  it("otro error no se reintenta", async () => {
    let attempts = 0;
    const uow: DatasetUnitOfWork = {
      run: () => {
        attempts++;
        return Promise.reject(new Error("caída"));
      },
    };
    await expect(loadFiscalCatalogs({ uow, datasets })).rejects.toThrow("caída");
    expect(attempts).toBe(1);
  });
});

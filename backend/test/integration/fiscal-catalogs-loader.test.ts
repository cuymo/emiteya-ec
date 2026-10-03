// Cargador de datasets normativos (add-fiscal-catalogs, design D3): atómico, idempotente y seguro
// con arranques simultáneos sobre una base vacía; fallos explícitos sin modificar nada.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FiscalCatalogDatasetConflict,
  loadFiscalCatalogs,
} from "../../src/modules/catalogs/application/dataset-loader.ts";
import type { DatasetUnitOfWork } from "../../src/modules/catalogs/application/ports.ts";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import {
  DatasetValidationError,
  datasetChecksum,
  validateDatasets,
  type DatasetFile,
  type ValidatedDataset,
} from "../../src/modules/catalogs/domain/datasets.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDatasetUnitOfWork } from "../../src/modules/catalogs/infrastructure/unit-of-work.ts";
import { createDatabase } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";

const IVA_INDEX = 2;
const counts = async (db: MigratedSchema) => {
  const prisma = db.database.prisma;
  return {
    datasets: await prisma.fiscalCatalogDataset.count(),
    keys: await prisma.fiscalCatalogKey.count(),
    entries: await prisma.fiscalCatalogEntry.count(),
    policy: await prisma.consumerFinalPolicy.count(),
    schemas: await prisma.schemaRegistryEntry.count(),
    cases: await prisma.specialCaseSupport.count(),
    audit: await prisma.auditEvent.count(),
  };
};
// 5 tipos de identificación + 3 impuestos + 9 IVA + 75 ICE + 1 IRBPNR + 8 formas de pago.
const LOADED = {
  datasets: 10,
  keys: 101,
  entries: 101,
  policy: 1,
  schemas: 13,
  cases: 26,
  audit: 0,
};

const validated = (file: DatasetFile): ValidatedDataset => ({
  ...file,
  checksum: datasetChecksum(file),
});
const ivaFile = () =>
  structuredClone(DATASET_FILES[IVA_INDEX]) as Extract<DatasetFile, { catalogType: "iva-rate" }>;

describe("cargador de catálogos fiscales", () => {
  describe("carga, idempotencia, transiciones y conflictos", () => {
    let db: MigratedSchema;

    beforeAll(async () => {
      db = await createMigratedSchema("catalog_loader");
    });
    afterAll(async () => {
      await db.drop();
    });

    it("aplica los diez datasets en una base vacía, sin auditoría", async () => {
      const report = await loadInstalledFiscalCatalogs(db.database.prisma);
      expect(report.applied).toHaveLength(10);
      expect(report.alreadyApplied).toEqual([]);
      expect(await counts(db)).toEqual(LOADED);
    });

    it("una segunda carga reconoce lo aplicado y no cambia nada", async () => {
      const before = await db.database.prisma.fiscalCatalogDataset.findMany({
        orderBy: { catalogType: "asc" },
      });
      const report = await loadInstalledFiscalCatalogs(db.database.prisma);
      expect(report.applied).toEqual([]);
      expect(report.alreadyApplied).toHaveLength(10);
      expect(await counts(db)).toEqual(LOADED);
      expect(
        await db.database.prisma.fiscalCatalogDataset.findMany({ orderBy: { catalogType: "asc" } }),
      ).toEqual(before);
    });

    it("la misma versión con otro contenido o con otra fuente falla sin modificar nada", async () => {
      const altered = structuredClone(DATASET_FILES) as unknown[];
      const iva = altered[IVA_INDEX] as { entries: { officialLabel: string }[] };
      iva.entries[3]!.officialLabel = "15 %";
      await expect(loadInstalledFiscalCatalogs(db.database.prisma, altered)).rejects.toThrow(
        "iva-rate v1: ya aplicado con otro contenido o con otra fuente",
      );
      const otherSource = structuredClone(DATASET_FILES) as unknown[];
      (otherSource[IVA_INDEX] as { source: { version: string } }).source.version = "2.35";
      await expect(
        loadInstalledFiscalCatalogs(db.database.prisma, otherSource),
      ).rejects.toBeInstanceOf(FiscalCatalogDatasetConflict);
      expect(await counts(db)).toEqual(LOADED);
      expect(
        (
          await db.database.prisma.fiscalCatalogEntry.findFirst({
            where: { catalogType: "iva-rate", entryKey: "4" },
          })
        )?.officialLabel,
      ).toBe("15%");
    });

    it("un dataset inválido se rechaza antes de abrir la transacción", async () => {
      const invalid = structuredClone(DATASET_FILES) as unknown[];
      (invalid[IVA_INDEX] as { entries: { percentage: unknown }[] }).entries[3]!.percentage = 15;
      await expect(loadInstalledFiscalCatalogs(db.database.prisma, invalid)).rejects.toBeInstanceOf(
        DatasetValidationError,
      );
      expect(await counts(db)).toEqual(LOADED);
    });

    let v2 = ivaFile();
    it("una versión posterior cierra vigencias, retira y añade versiones, y lo registra", async () => {
      v2 = ivaFile();
      v2.version = 2;
      const twelve = v2.entries.find((entry) => entry.code === "2")!;
      twelve.effectiveTo = "2026-12-31";
      twelve.normativeStatus = "WITHDRAWN";
      const fifteen = v2.entries.find((entry) => entry.code === "4")!;
      fifteen.effectiveTo = "2026-12-31";
      v2.entries.push({
        ...fifteen,
        effectiveFrom: "2027-01-01",
        effectiveTo: null,
        effectiveFromBasis: "SOURCE_STATED",
      });
      const files = [...DATASET_FILES, v2];
      const report = await loadInstalledFiscalCatalogs(db.database.prisma, files);
      expect(report.applied).toEqual([{ catalogType: "iva-rate", version: 2, newEntries: 1 }]);
      const versions = await db.database.prisma.fiscalCatalogEntry.findMany({
        where: { catalogType: "iva-rate", entryKey: { in: ["2", "4"] } },
        orderBy: [{ entryKey: "asc" }, { effectiveFrom: "asc" }],
      });
      expect(
        versions.map((v) => [
          v.entryKey,
          v.effectiveFrom.toISOString().slice(0, 10),
          v.effectiveTo?.toISOString().slice(0, 10) ?? null,
          v.normativeStatus,
          v.datasetVersion,
          v.closedInDatasetVersion,
          v.statusChangedInDatasetVersion,
        ]),
      ).toEqual([
        ["2", "2026-07-27", "2026-12-31", "WITHDRAWN", 1, 2, 2],
        ["4", "2026-07-27", "2026-12-31", "OFFICIAL", 1, 2, null],
        ["4", "2027-01-01", null, "OFFICIAL", 2, null, null],
      ]);
      expect((await loadInstalledFiscalCatalogs(db.database.prisma, files)).applied).toEqual([]);
    });

    it("una alteración de lo publicado, aunque llegue sin la cadena de archivos, nombra la entrada", async () => {
      const altered = structuredClone(v2);
      altered.version = 3;
      altered.entries[0]!.officialLabel = "Cero por ciento";
      await expect(
        loadFiscalCatalogs({
          uow: createDatasetUnitOfWork(db.database.prisma),
          datasets: [validated(altered)],
        }),
      ).rejects.toThrow("iva-rate v3: altera la versión publicada 0@2026-07-27");
      const missing = ivaFile();
      missing.version = 3;
      await expect(
        loadFiscalCatalogs({
          uow: createDatasetUnitOfWork(db.database.prisma),
          datasets: [validated(missing)],
        }),
      ).rejects.toThrow("iva-rate v3: falta la versión publicada 4@2027-01-01");
    });
  });

  it("dos cargadores simultáneos sobre una base vacía aplican una sola vez y ambos terminan", async () => {
    const db = await createMigratedSchema("catalog_loader_race");
    const second = createDatabase(db.url);
    try {
      const datasets = validateDatasets(DATASET_FILES);
      const [a, b] = await Promise.all([
        loadFiscalCatalogs({ uow: createDatasetUnitOfWork(db.database.prisma), datasets }),
        loadFiscalCatalogs({ uow: createDatasetUnitOfWork(second.prisma), datasets }),
      ]);
      expect([a.applied.length, b.applied.length].sort()).toEqual([0, 10]);
      expect([a.alreadyApplied.length, b.alreadyApplied.length].sort()).toEqual([0, 10]);
      expect(await counts(db)).toEqual(LOADED);
    } finally {
      await second.close();
      await db.drop();
    }
  });

  it("un fallo a mitad de la aplicación no deja ninguna fila", async () => {
    const db = await createMigratedSchema("catalog_loader_partial");
    try {
      const real = createDatasetUnitOfWork(db.database.prisma);
      const failing: DatasetUnitOfWork = {
        run: (work) =>
          real.run((store) =>
            work({
              ...store,
              insertSpecialCases: () => Promise.reject(new Error("fallo inyectado")),
            }),
          ),
      };
      await expect(
        loadFiscalCatalogs({ uow: failing, datasets: validateDatasets(DATASET_FILES) }),
      ).rejects.toThrow("fallo inyectado");
      expect(await counts(db)).toEqual({
        datasets: 0,
        keys: 0,
        entries: 0,
        policy: 0,
        schemas: 0,
        cases: 0,
        audit: 0,
      });
    } finally {
      await db.drop();
    }
  });
});

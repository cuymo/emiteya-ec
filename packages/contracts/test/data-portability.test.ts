// Contratos de la portabilidad (add-data-portability, design D10 y D17).
import { describe, expect, it } from "vitest";
import {
  DATA_EXPORT_FAILURE_CODES,
  DATA_EXPORT_STATUSES,
  DATA_EXPORT_STATUS_LABELS,
  createDataExportSchema,
  dataExportViewSchema,
  listDataExportsQuerySchema,
  type DataExportView,
} from "../src/data-portability.ts";

const ready: DataExportView = {
  id: "e1",
  status: "READY",
  phase: null,
  progress: null,
  requestedBy: { name: "Ana" },
  requestedAt: "2026-10-08T12:00:00.000Z",
  startedAt: "2026-10-08T12:00:01.000Z",
  snapshotAt: "2026-10-08T12:00:02.000Z",
  generatedAt: "2026-10-08T12:05:00.000Z",
  expiresAt: "2026-10-09T12:05:00.000Z",
  finishedAt: null,
  sizeBytes: "2600000000",
  sha256: "a".repeat(64),
  formatVersion: "1",
  counts: {
    documentsTest: 2000,
    documentsProduction: 100000,
    files: 520000,
    parties: 10000,
    products: 10000,
    stockMovements: 300000,
    auditEvents: 300000,
    users: 10,
  },
  errorCode: null,
  expiredReason: null,
};

describe("contratos de la portabilidad", () => {
  it("la solicitud no admite datos: rechaza un companyId", () => {
    expect(createDataExportSchema.safeParse({}).success).toBe(true);
    expect(createDataExportSchema.safeParse({ companyId: "otra" }).success).toBe(false);
  });

  it("tiene cinco estados explícitos con sus etiquetas", () => {
    expect(DATA_EXPORT_STATUSES).toEqual(["QUEUED", "GENERATING", "READY", "FAILED", "EXPIRED"]);
    expect(Object.values(DATA_EXPORT_STATUS_LABELS)).toEqual([
      "En cola",
      "Generando",
      "Lista",
      "Fallida",
      "Expirada",
    ]);
  });

  it("valida la vista de un paquete listo, fallido y caducado", () => {
    expect(dataExportViewSchema.parse(ready)).toEqual(ready);
    const failed = { ...ready, status: "FAILED", errorCode: "DATA_EXPORT_PACKAGE_MISSING" };
    expect(dataExportViewSchema.safeParse(failed).success).toBe(true);
    expect(dataExportViewSchema.safeParse({ ...failed, errorCode: "/var/data/ruta" }).success).toBe(
      false,
    );
    expect(
      dataExportViewSchema.safeParse({ ...ready, status: "EXPIRED", expiredReason: "TTL" }).success,
    ).toBe(true);
    expect(
      dataExportViewSchema.safeParse({ ...ready, status: "EXPIRED", expiredReason: "FILE_MISSING" })
        .success,
    ).toBe(false);
    expect(dataExportViewSchema.safeParse({ ...ready, sizeBytes: "0" }).success).toBe(false);
    expect(dataExportViewSchema.safeParse({ ...ready, formatVersion: "2" }).success).toBe(false);
    expect(dataExportViewSchema.safeParse({ ...ready, fileName: "x.zip" }).success).toBe(false);
  });

  it("los códigos de falla incluyen los del paquete listo perdido o alterado", () => {
    expect(DATA_EXPORT_FAILURE_CODES).toEqual(
      expect.arrayContaining(["DATA_EXPORT_PACKAGE_MISSING", "DATA_EXPORT_PACKAGE_INTEGRITY"]),
    );
  });

  it("pagina la lista y rechaza un companyId", () => {
    expect(listDataExportsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    expect(listDataExportsQuerySchema.safeParse({ companyId: "x" }).success).toBe(false);
  });
});

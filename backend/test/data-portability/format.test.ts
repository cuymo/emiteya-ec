// Dominio del formato `PORTABILITY_FORMAT_V1` (add-data-portability, design D2, D3, D8 y D13).
import { describe, expect, it } from "vitest";
import type { DocumentRow } from "../../src/modules/data-portability/application/ports.ts";
import {
  MissingArtifactError,
  PackagePathError,
  artifactPlan,
  assertPackagePath,
  checksumLine,
  createPathGuard,
  documentFolder,
  logoFile,
  packageFileName,
  responseFile,
} from "../../src/modules/data-portability/domain/format.ts";
import {
  buildManifest,
  readmeBytes,
  type ManifestInput,
} from "../../src/modules/data-portability/domain/manifest.ts";
import {
  DOCUMENTS,
  MAX_DATA_ROWS,
  sheetNames,
  type Lookups,
} from "../../src/modules/data-portability/domain/sheets.ts";

const SHA = "a".repeat(64);
const document = (overrides: Partial<DocumentRow> = {}): DocumentRow => ({
  id: "d1",
  environment: "TEST",
  documentType: "01",
  documentNumber: "001-001-000000001",
  accessKey: "1".repeat(49),
  issueDate: "2026-10-07",
  state: "AUTHORIZED",
  counterpartIdentification: "0102030405",
  counterpartName: "../../etc/passwd",
  recipientCount: null,
  subtotal: "100",
  taxes: "15",
  total: "115",
  authorizationNumber: "1".repeat(49),
  authorizationDate: new Date("2026-10-07T15:00:00Z"),
  snapshotVersion: 2,
  schemaVersion: "1.1.0",
  snapshotBytes: 4096,
  artifacts: [
    { id: "a1", kind: "SIGNED_XML", sizeBytes: 10, sha256: SHA },
    { id: "a2", kind: "AUTHORIZED_XML", sizeBytes: 12, sha256: SHA },
  ],
  responses: [],
  rideJobStatus: null,
  ...overrides,
});
const lookups: Lookups = {
  userEmail: () => null,
  establishmentCode: () => null,
  pointCode: () => null,
  product: () => null,
  logoSha256: () => null,
};

describe("rutas del paquete", () => {
  it("acepta las rutas del formato y rechaza todo lo que sale de su gramática", () => {
    for (const ok of [
      "manifest.json",
      "SHA256SUMS",
      "LEEME.txt",
      "data/comprobantes.xlsx",
      "documents/pruebas/01-factura/001-001-000000001/sri/001-recepcion.xml",
    ])
      expect(assertPackagePath(ok)).toBe(ok);
    for (const bad of [
      "",
      "/etc/passwd",
      "a/../b",
      "../x",
      "a\\b",
      "a//b",
      "a/b/",
      ".oculto",
      "a/\nb",
      "a\tb",
      "a\u0000b",
      "ruta con espacios",
      "x".repeat(201),
    ])
      expect(() => assertPackagePath(bad), JSON.stringify(bad)).toThrow(PackagePathError);
  });

  it("nunca usa la razón social ni el RUC: una razón social como ruta no llega a ningún archivo", () => {
    const folder = documentFolder(document());
    expect(folder).toBe("documents/pruebas/01-factura/001-001-000000001");
    expect(folder).not.toContain("passwd");
    // La razón social solo es el texto de una celda.
    expect(DOCUMENTS.row(document(), lookups)).toContain("../../etc/passwd");
    expect(packageFileName(new Date("2026-10-08T17:34:56Z"))).toBe("datos-20261008-123456.zip");
  });

  it("separa el mismo número en los dos ambientes y rechaza un comprobante sin carpeta válida", () => {
    expect(documentFolder(document({ environment: "PRODUCTION" }))).toBe(
      "documents/produccion/01-factura/001-001-000000001",
    );
    expect(() => documentFolder(document({ documentNumber: "../1" }))).toThrow(PackagePathError);
    expect(() => documentFolder(document({ documentType: "99" }))).toThrow(PackagePathError);
  });

  it("nombra las respuestas por su intento y su operación, y los logos por su hash", () => {
    expect(
      responseFile({ attemptNumber: 1, operation: "RECEPTION", contentType: "text/xml" }),
    ).toBe("sri/001-recepcion.xml");
    expect(
      responseFile({ attemptNumber: 12, operation: "AUTHORIZATION", contentType: "text/html" }),
    ).toBe("sri/012-autorizacion.bin");
    expect(() => responseFile({ attemptNumber: 1, operation: "../x", contentType: null })).toThrow(
      PackagePathError,
    );
    expect(logoFile({ sha256: SHA, mimeType: "image/jpeg" })).toBe(`assets/logos/${SHA}.jpg`);
    expect(() => logoFile({ sha256: "../x", mimeType: "image/png" })).toThrow(PackagePathError);
  });

  it("rechaza una ruta repetida y las carpetas fuera de orden, sin aceptarlas en silencio", () => {
    const guard = createPathGuard();
    guard.folder("documents/produccion/01-factura/001-001-000000001");
    expect(guard.file("snapshot.json")).toBe(
      "documents/produccion/01-factura/001-001-000000001/snapshot.json",
    );
    expect(() => guard.file("snapshot.json")).toThrow(PackagePathError);
    guard.folder("documents/pruebas/01-factura/001-001-000000001");
    expect(() => guard.folder("documents/pruebas/01-factura/001-001-000000001")).toThrow(
      PackagePathError,
    );
    expect(() =>
      guard.folder("documents/produccion/07-comprobante-de-retencion/001-001-000000001"),
    ).toThrow(PackagePathError);
    guard.loose("data/empresa.xlsx");
    expect(() => guard.loose("data/empresa.xlsx")).toThrow(PackagePathError);
  });

  it("escribe las líneas de SHA256SUMS como sha256sum", () => {
    expect(checksumLine(SHA, "manifest.json")).toBe(`${SHA}  manifest.json\n`);
    expect(() => checksumLine("x", "manifest.json")).toThrow();
    expect(() => checksumLine(SHA, "../manifest.json")).toThrow(PackagePathError);
  });
});

describe("artefactos esperados y ausentes", () => {
  it("declara el RIDE pendiente o detenido como ausente legítimo, nunca lo genera", () => {
    expect(artifactPlan(document()).absent).toEqual([
      expect.objectContaining({ artifact: "RIDE_PDF", reason: "RIDE_PENDING" }),
    ]);
    expect(artifactPlan(document({ rideJobStatus: "STOPPED" })).absent).toEqual([
      expect.objectContaining({ artifact: "RIDE_PDF", reason: "RIDE_STOPPED" }),
    ]);
  });

  it("no espera artefactos de un comprobante reservado", () => {
    expect(artifactPlan(document({ state: "RESERVED", artifacts: [] }))).toEqual({
      artifacts: [],
      absent: [],
    });
  });

  it("falla cerrado si falta un XML que el estado exige", () => {
    expect(() => artifactPlan(document({ state: "SIGNED", artifacts: [] }))).toThrow(
      MissingArtifactError,
    );
    expect(() =>
      artifactPlan(
        document({ artifacts: [{ id: "a1", kind: "SIGNED_XML", sizeBytes: 1, sha256: SHA }] }),
      ),
    ).toThrow(MissingArtifactError);
  });
});

describe("manifiesto, LEEME y hojas", () => {
  const input: ManifestInput = {
    generatedAt: new Date("2026-10-08T17:00:00Z"),
    snapshotAt: new Date("2026-10-08T16:59:00Z"),
    applicationVersion: "0.0.0",
    company: { ruc: "1790012345001", legalName: "COMERCIAL ANDINA S.A.", tradeName: null },
    counts: {
      documents: { TEST: 2, PRODUCTION: 1, byType: { "01": 3 }, byState: { AUTHORIZED: 3 } },
      artifacts: { signedXml: 3, authorizedXml: 3, ride: 2, sriResponses: 4, logos: 1 },
      files: 25,
    },
    datasets: [
      {
        dataset: "Comprobantes",
        workbook: "data/comprobantes.xlsx",
        sheets: ["Comprobantes"],
        rows: 3,
      },
    ],
    snapshotVersions: { "01": [2] },
    xmlSchemas: { "01": ["1.1.0"] },
    absent: [artifactPlan(document()).absent[0]!],
  };

  it("lleva la versión, los momentos, el alcance, las exclusiones y los ausentes, nunca el inventario", () => {
    const manifest = buildManifest(input);
    expect(manifest).toMatchObject({
      format: "PORTABILITY_FORMAT_V1",
      formatVersion: "1",
      snapshotAt: "2026-10-08T16:59:00.000Z",
      snapshotAtEcuador: "2026-10-08 11:59:00",
      scope: { environments: ["PRODUCTION", "TEST"] },
      absent: [expect.objectContaining({ reason: "RIDE_PENDING" })],
    });
    expect(manifest.exclusions.map((e) => e.data).join(" ")).toMatch(
      /P12.*autenticación.*borradores/s,
    );
    expect(JSON.stringify(manifest)).not.toMatch(/firmado\.xml|ride\.pdf|SHA256SUMS"/);
  });

  it("LEEME dice que no es un respaldo, qué excluye y cómo verificarlo", () => {
    const text = Buffer.from(readmeBytes(input)).toString("utf8");
    expect(text).toMatch(/NO es un respaldo/);
    expect(text).toMatch(/firma electrónica/);
    expect(text).toMatch(/borradores/);
    expect(text).toMatch(/Pruebas y de Producción/);
    expect(text).toMatch(/sha256sum -c SHA256SUMS/);
  });

  it("divide un conjunto en hojas exactamente en el máximo de filas de Excel", () => {
    expect(MAX_DATA_ROWS).toBe(1_048_575);
    expect(sheetNames("Movimientos", 0)).toEqual(["Movimientos"]);
    expect(sheetNames("Movimientos", MAX_DATA_ROWS - 1)).toEqual(["Movimientos"]);
    expect(sheetNames("Movimientos", MAX_DATA_ROWS)).toEqual(["Movimientos"]);
    expect(sheetNames("Movimientos", MAX_DATA_ROWS + 1)).toEqual([
      "Movimientos",
      "Movimientos (2)",
    ]);
    expect(sheetNames("Movimientos", 2 * MAX_DATA_ROWS + 1)).toHaveLength(3);
  });

  it("escribe la guía de varios destinatarios sin un tercero ni importes inventados", () => {
    const row = DOCUMENTS.row(
      document({
        documentType: "06",
        state: "SIGNED",
        recipientCount: 3,
        counterpartIdentification: null,
        counterpartName: null,
        subtotal: null,
        taxes: null,
        total: null,
        artifacts: [{ id: "a1", kind: "SIGNED_XML", sizeBytes: 1, sha256: SHA }],
      }),
      lookups,
    );
    expect(row.slice(7, 12)).toEqual([null, "3 destinatarios", null, null, null]);
  });
});

// Datasets normativos de la versión instalada (add-fiscal-catalogs, design D2, D3, D7 y D8): formato,
// manifiesto, valores críticos fijados, base de las fechas y registro de esquemas contra los XSD.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import {
  DatasetValidationError,
  validateDatasets,
  type ValidatedDataset,
} from "../../src/modules/catalogs/domain/datasets.ts";

const FICHA_SHA256 = "7333aebfbdf2cb3ba83f9fc67a7a7f0346ca59506480a260cc42f96dbdfc13c9";
const DOCS = new URL("../../../docs/product/", import.meta.url);
const datasets = validateDatasets(DATASET_FILES);
const byType = (type: string) => datasets.find((dataset) => dataset.catalogType === type)!;
const entries = (type: string) =>
  (byType(type) as Extract<ValidatedDataset, { entries: unknown[] }>).entries as Record<
    string,
    unknown
  >[];

describe("datasets de la versión instalada", () => {
  it("los diez datasets validan y coinciden con el manifiesto", () => {
    const manifest = readFileSync(new URL("sri-catalogs/README.md", DOCS), "utf8");
    const rows = [
      ...manifest.matchAll(/^\| `([a-z-]+)` \| (\d+) \| [^|]+ \| (\d+) \| `([0-9a-f]{64})` \|$/gm),
    ].map(([, type, version, count, checksum]) => ({
      type,
      version: Number(version),
      count: Number(count),
      checksum,
    }));
    expect(
      datasets
        .map((dataset) => ({
          type: dataset.catalogType,
          version: dataset.version,
          count: "entries" in dataset ? dataset.entries.length : dataset.versions.length,
          checksum: dataset.checksum,
        }))
        .sort((a, b) => a.type.localeCompare(b.type)),
    ).toEqual(rows.sort((a, b) => a.type!.localeCompare(b.type!)));
    expect(rows).toHaveLength(10);
  });

  it("citan la ficha v2.34 por su hash, y el registro, el manifiesto de los XSD", () => {
    const xsdManifest = readFileSync(new URL("sri-xsd/README.md", DOCS));
    for (const dataset of datasets) {
      const expected =
        dataset.catalogType === "schema-registry"
          ? createHash("sha256").update(xsdManifest).digest("hex")
          : FICHA_SHA256;
      expect(dataset.source.sha256, dataset.catalogType).toBe(expected);
    }
  });

  it("solo las formas de pago declaran su fecha; el resto usa la base del proyecto, sin historia", () => {
    for (const dataset of datasets) {
      if (!("entries" in dataset) || !("effectiveFrom" in (dataset.entries[0] ?? {}))) continue;
      for (const entry of entries(dataset.catalogType)) {
        if (dataset.catalogType === "payment-method") {
          expect(entry.effectiveFromBasis).toBe("SOURCE_STATED");
        } else {
          expect(entry.effectiveFromBasis, `${dataset.catalogType}/${String(entry.entryKey)}`).toBe(
            "PROJECT_BASELINE",
          );
          expect(entry.effectiveFrom).toBe("2026-07-27");
        }
        expect(entry.effectiveTo).toBeNull();
      }
    }
    const policy = byType("consumer-final-policy");
    expect("versions" in policy && policy.versions[0]?.effectiveFromBasis).toBe("PROJECT_BASELINE");
  });

  it("fija las tarifas de IVA de la tabla 17", () => {
    expect(
      entries("iva-rate").map((e) => [e.code, e.officialLabel, e.rateKind, e.percentage]),
    ).toEqual([
      ["0", "0%", "PERCENTAGE", "0"],
      ["2", "12%", "PERCENTAGE", "12"],
      ["3", "14%", "PERCENTAGE", "14"],
      ["4", "15%", "PERCENTAGE", "15"],
      ["5", "5%", "PERCENTAGE", "5"],
      ["6", "No Objeto de Impuesto", "NOT_SUBJECT", null],
      ["7", "Exento de IVA", "EXEMPT", null],
      ["8", "IVA diferenciado", "DIFFERENTIATED", null],
      ["10", "13%", "PERCENTAGE", "13"],
    ]);
  });

  it("fija los impuestos de la tabla 16 y el IRBPNR sin tarifa", () => {
    expect(entries("tax").map((e) => [e.code, e.taxKind])).toEqual([
      ["2", "IVA"],
      ["3", "ICE"],
      ["5", "IRBPNR"],
    ]);
    expect(entries("irbpnr-rate")).toEqual([
      expect.objectContaining({ code: "5001", normativeStatus: "OFFICIAL_REFERENCE" }),
    ]);
    expect(Object.keys(entries("irbpnr-rate")[0]!)).not.toEqual(
      expect.arrayContaining(["percentage", "unitAmount", "rateKind"]),
    );
  });

  it("fija las formas de pago de la tabla 24 con sus fechas declaradas", () => {
    expect(
      entries("payment-method").map((e) => [e.code, e.officialLabel, e.effectiveFrom]),
    ).toEqual([
      ["01", "SIN UTILIZACION DEL SISTEMA FINANCIERO", "2013-01-01"],
      ["15", "COMPENSACIÓN DE DEUDAS", "2013-01-01"],
      ["16", "TARJETA DE DÉBITO", "2016-06-01"],
      ["17", "DINERO ELECTRÓNICO", "2016-06-01"],
      ["18", "TARJETA PREPAGO", "2016-06-01"],
      ["19", "TARJETA DE CRÉDITO", "2016-06-01"],
      ["20", "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO", "2016-06-01"],
      ["21", "ENDOSO DE TÍTULOS", "2016-06-01"],
    ]);
  });

  it("fija la política de consumidor final y su identidad canónica", () => {
    const policy = byType("consumer-final-policy");
    expect("versions" in policy && policy.versions).toEqual([
      expect.objectContaining({
        maxAmount: "50.00",
        currency: "USD",
        identificationType: "07",
        identification: "9999999999999",
        canonicalName: "CONSUMIDOR FINAL",
      }),
    ]);
  });

  it("los tipos de identificación traen su regla de formato, sin dígito verificador", () => {
    const rule = (code: string) => {
      const entry = entries("identification-type").find((e) => e.code === code)!;
      return new RegExp(entry.identificationPattern as string);
    };
    expect(rule("04").test("1790012345001")).toBe(true);
    // Sin algoritmo local: un RUC cuyo dígito verificador no cumple ninguno es válido (ERS RF-322).
    expect(rule("04").test("1234567890001")).toBe(true);
    expect(rule("04").test("179001234500")).toBe(false);
    expect(rule("04").test("1790012345002")).toBe(false);
    expect(rule("05").test("1712345678")).toBe(true);
    expect(rule("05").test("17123456A8")).toBe(false);
    expect(rule("06").test("A".repeat(20))).toBe(true);
    expect(rule("06").test("A".repeat(21))).toBe(false);
    expect(rule("08").test("X\nY")).toBe(false);
    expect(entries("identification-type").find((e) => e.code === "07")).toMatchObject({
      reservedFor: "CONSUMER_FINAL",
    });
  });

  it("todo código de tarifa cumple codigoPorcentaje del XSD (1 a 4 dígitos)", () => {
    for (const type of ["iva-rate", "ice-rate", "irbpnr-rate"]) {
      for (const entry of entries(type)) expect(entry.code).toMatch(/^[0-9]{1,4}$/);
    }
  });

  it("fija las categorías de la matriz del ADR 0014", () => {
    const matrix = byType("special-case-matrix");
    const byCategory: Record<string, number[]> = {};
    for (const entry of "entries" in matrix
      ? (matrix.entries as { annex: number; category: string }[])
      : []) {
      (byCategory[entry.category] ??= []).push(entry.annex);
    }
    expect(byCategory).toEqual({
      CORE: [1, 2, 3, 10, 14, 17],
      CONDITIONAL_ISSUER_RULE: [21, 22, 24],
      CONDITIONAL_GO_LIVE: [26],
      NOT_APPLICABLE: [15],
      OUT_OF_MVP: [4, 5, 6, 7, 8, 9, 11, 12, 13, 16, 18, 19, 20, 23, 25],
    });
  });

  it("el registro de esquemas coincide con los XSD versionados y sus hashes", () => {
    for (const entry of entries("schema-registry")) {
      const file = readFileSync(new URL(`sri-xsd/${String(entry.file)}`, DOCS));
      expect(createHash("sha256").update(file).digest("hex"), String(entry.file)).toBe(
        entry.sha256,
      );
      expect(entry.supported).toBe(true);
    }
    expect(
      entries("schema-registry").map((e) => `${String(e.documentType)}@${String(e.version)}`),
    ).toEqual(["01@1.1.0", "03@1.1.0", "04@1.1.0", "05@1.0.0", "06@1.1.0", "07@2.0.0"]);
  });

  it("el registro 2 incluye todos los archivos de una validación, con su ruta lógica y su hash", () => {
    const registry = datasets.find(
      (dataset) => dataset.catalogType === "schema-registry" && dataset.version === 2,
    ) as Extract<(typeof datasets)[number], { catalogType: "schema-registry" }>;
    const byPath = new Map(
      registry.entries.map((entry) => ["path" in entry ? entry.path : "", entry]),
    );
    for (const [path, entry] of byPath) {
      const file = readFileSync(new URL(path, DOCS));
      expect(createHash("sha256").update(file).digest("hex"), path).toBe(entry.sha256);
    }
    expect([...byPath.keys()].sort()).toEqual([
      "sri-xsd/ComprobanteRetencion_V2.0.0.xsd",
      "sri-xsd/GuiaRemision_V1.1.0.xsd",
      "sri-xsd/LiquidacionCompra_V1.1.0.xsd",
      "sri-xsd/NotaCredito_V1.1.0.xsd",
      "sri-xsd/NotaDebito_V1.0.0.xsd",
      "sri-xsd/factura_V1.1.0.xsd",
      "w3c-xsd/xmldsig-core-schema.xsd",
    ]);
    const xmldsig = byPath.get("w3c-xsd/xmldsig-core-schema.xsd");
    expect(xmldsig).toMatchObject({ kind: "IMPORT", revision: "1.2 (2013-04-16)" });
    for (const entry of registry.entries) {
      if ("kind" in entry && entry.kind === "DOCUMENT") {
        expect(entry.imports, entry.path).toEqual(["w3c-xsd/xmldsig-core-schema.xsd"]);
      }
    }
  });

  it("un documento que importa un archivo no registrado no valida", () => {
    const registry = structuredClone(
      DATASET_FILES.find(
        (file) =>
          (file as { catalogType: string; version: number }).catalogType === "schema-registry" &&
          (file as { version: number }).version === 2,
      ),
    ) as { entries: { kind: string; imports?: string[] }[] };
    registry.entries = registry.entries.filter((entry) => entry.kind === "DOCUMENT");
    expect(() =>
      validateDatasets(
        DATASET_FILES.map((file) =>
          (file as { catalogType: string; version: number }).catalogType === "schema-registry" &&
          (file as { version: number }).version === 2
            ? registry
            : file,
        ),
      ),
    ).toThrow(/importa w3c-xsd\/xmldsig-core-schema.xsd, no registrado/);
  });
});

describe("validación de datasets (design D3 y D4)", () => {
  const iva = structuredClone(DATASET_FILES[2]) as {
    version: number;
    entries: Record<string, unknown>[];
  };
  const ivaV2 = (mutate: (file: typeof iva) => void) => {
    const next = structuredClone(iva);
    next.version = 2;
    mutate(next);
    return next;
  };
  const fails = (files: unknown[]) => {
    try {
      validateDatasets(files);
      return null;
    } catch (error) {
      expect(error).toBeInstanceOf(DatasetValidationError);
      return (error as Error).message;
    }
  };

  it("rechaza versiones superpuestas de una misma entrada", () => {
    const next = ivaV2((file) =>
      file.entries.push({ ...file.entries[3]!, effectiveFrom: "2026-09-01" }),
    );
    expect(fails([iva, next])).toContain("versiones superpuestas de 4");
  });

  it("permite cerrar una vigencia y retirar una entrada, y añadir la versión siguiente", () => {
    const next = ivaV2((file) => {
      file.entries[1] = {
        ...file.entries[1]!,
        effectiveTo: "2026-12-31",
        normativeStatus: "WITHDRAWN",
      };
      file.entries.push({ ...file.entries[3]!, effectiveFrom: "2027-01-01", effectiveTo: null });
      file.entries[3] = { ...file.entries[3]!, effectiveTo: "2026-12-31" };
    });
    expect(fails([iva, next])).toBeNull();
  });

  it("rechaza alterar, quitar o reactivar una versión publicada", () => {
    expect(
      fails([
        iva,
        ivaV2((file) => (file.entries[3] = { ...file.entries[3]!, officialLabel: "15 %" })),
      ]),
    ).toContain("altera la versión publicada 4@2026-07-27");
    expect(fails([iva, ivaV2((file) => file.entries.splice(0, 1))])).toContain(
      "desaparece la versión 0@2026-07-27",
    );
    const withdrawn = ivaV2((file) => {
      file.entries[1] = {
        ...file.entries[1]!,
        effectiveTo: "2026-12-31",
        normativeStatus: "WITHDRAWN",
      };
    });
    const reactivated = structuredClone(withdrawn);
    reactivated.version = 3;
    reactivated.entries[1] = { ...reactivated.entries[1]!, normativeStatus: "OFFICIAL" };
    expect(fails([iva, withdrawn, reactivated])).toContain("reactiva la versión retirada");
  });

  it("rechaza versiones no contiguas, tarifas en ICE y porcentajes fuera de su semántica", () => {
    expect(fails([ivaV2(() => {})])).toContain("versiones no contiguas");
    const ice = structuredClone(DATASET_FILES[3]) as { entries: Record<string, unknown>[] };
    ice.entries[0] = { ...ice.entries[0]!, percentage: "75" };
    expect(fails([ice])).toContain("dataset 1 inválido");
    const differentiated = structuredClone(iva);
    differentiated.entries[7] = { ...differentiated.entries[7]!, percentage: "8" };
    expect(fails([differentiated])).toContain("el porcentaje existe solo en tarifas PERCENTAGE");
  });

  it("rechaza una política de habilitación incoherente con el catálogo", () => {
    const tax = structuredClone(DATASET_FILES[1]) as { enablementPolicy: string };
    tax.enablementPolicy = "DEFAULT_ENABLED";
    expect(fails([tax])).toContain("política de habilitación incoherente");
  });
});

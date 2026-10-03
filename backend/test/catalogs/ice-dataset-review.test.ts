// Revisión fila a fila de la tabla 18 de la ficha v2.34 (add-fiscal-catalogs, design D6): el dataset
// de ICE contra el extracto literal versionado en docs/product/sri-catalogs/fuentes/.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";

type IceEntry = {
  entryKey: string;
  code: string;
  officialLabel: string;
  sourceRef: string;
  normativeStatus: string;
};

const excerpt = readFileSync(
  new URL("../../../docs/product/sri-catalogs/fuentes/ficha-v2.34-tabla-18.txt", import.meta.url),
  "utf8",
);
const lines = excerpt.split("\n").filter((line) => !line.startsWith("#"));
const sourceRows = lines.flatMap((line, index) => {
  const match = /^\s*(3\d{3})\s/.exec(line);
  return match ? [{ code: match[1]!, index }] : [];
});
const ice = (DATASET_FILES as { catalogType: string; entries: IceEntry[] }[]).find(
  (file) => file.catalogType === "ice-rate",
)!.entries;
const count = (values: string[]) =>
  values.reduce<Record<string, number>>(
    (acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }),
    {},
  );
const repeated = (counts: Record<string, number>) =>
  Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 1));

describe("tabla 18 de la ficha v2.34: dataset de ICE", () => {
  it("la fuente tiene 76 filas y 71 códigos distintos", () => {
    expect(sourceRows).toHaveLength(76);
    expect(new Set(sourceRows.map((row) => row.code)).size).toBe(71);
  });

  it("solo 3041 y 3541 se repiten con denominaciones distintas, y 3671 se repite idéntico", () => {
    expect(repeated(count(sourceRows.map((row) => row.code)))).toEqual({
      "3041": 3,
      "3541": 3,
      "3671": 2,
    });
    const rows3671 = sourceRows
      .filter((row) => row.code === "3671")
      .map((row) =>
        lines
          .slice(row.index - 1, row.index + 2)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    expect(rows3671[0]).toBe(rows3671[1]);
  });

  it("el dataset tiene 75 entradas: las filas de la fuente menos la repetición idéntica de 3671", () => {
    expect(ice).toHaveLength(75);
    const expected = count(sourceRows.map((row) => row.code));
    expected["3671"] = 1;
    expect(count(ice.map((entry) => entry.code))).toEqual(expected);
    expect(repeated(count(ice.map((entry) => entry.code)))).toEqual({ "3041": 3, "3541": 3 });
    expect(ice.find((entry) => entry.code === "3671")?.sourceRef).toBe(
      "Tabla 18, páginas 31 y 32 (la fuente repite la fila idéntica)",
    );
  });

  it("los entryKey son únicos; las variantes tienen sufijo explícito y denominaciones distintas", () => {
    expect(new Set(ice.map((entry) => entry.entryKey)).size).toBe(75);
    for (const entry of ice) {
      expect(entry.entryKey).toMatch(/^[0-9A-Z][0-9A-Z-]{0,63}$/);
      if (entry.entryKey !== entry.code)
        expect(entry.entryKey.startsWith(`${entry.code}-`)).toBe(true);
    }
    expect(
      ice.filter((entry) => entry.entryKey !== entry.code).map((entry) => entry.entryKey),
    ).toEqual([
      "3041-GRAN-ESCALA",
      "3041-MEDIANA-ESCALA",
      "3041-PEQUENA-ESCALA",
      "3541-GRAN-ESCALA-CAE",
      "3541-MEDIANA-ESCALA-CAE",
      "3541-PEQUENA-ESCALA-CAE",
    ]);
    for (const code of ["3041", "3541"]) {
      const labels = ice.filter((entry) => entry.code === code).map((entry) => entry.officialLabel);
      expect(new Set(labels).size).toBe(3);
    }
  });

  it("cada denominación aparece, palabra por palabra y en orden, en el bloque de su fila", () => {
    const blocks = sourceRows.map((row) =>
      lines
        .slice(Math.max(0, row.index - 3), row.index + 5)
        .join(" ")
        .replace(/\s+/g, " "),
    );
    for (const entry of ice) {
      const words = entry.officialLabel
        .split(" ")
        .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const pattern = new RegExp(words.join("[\\s\\S]*?"));
      const ownBlocks = sourceRows
        .map((row, i) => ({ row, block: blocks[i]! }))
        .filter(({ row }) => row.code === entry.code);
      expect(
        ownBlocks.some(({ block }) => pattern.test(block)),
        `${entry.entryKey}: "${entry.officialLabel}"`,
      ).toBe(true);
    }
  });

  it("cada entrada cita tabla y página, es una referencia oficial y no trae tarifas", () => {
    for (const entry of ice) {
      expect(entry.sourceRef).toMatch(/^Tabla 18, páginas? (30|31|32)/);
      expect(entry.normativeStatus).toBe("OFFICIAL_REFERENCE");
      expect(Object.keys(entry).sort()).toEqual([
        "code",
        "effectiveFrom",
        "effectiveFromBasis",
        "effectiveTo",
        "entryKey",
        "normativeStatus",
        "officialLabel",
        "sourceRef",
      ]);
    }
  });

  it("las páginas citadas son las de cada fila en la fuente", () => {
    // Página de cada línea del extracto (sin comentarios), según los marcadores de página.
    const pageOfLine: string[] = [];
    let page = "";
    for (const raw of excerpt.split("\n")) {
      const marker = /^# ---- Página (\d+) ----$/.exec(raw);
      if (marker) page = marker[1]!;
      else if (!raw.startsWith("#")) pageOfLine.push(page);
    }
    const pagesByCode = new Map<string, Set<string>>();
    for (const row of sourceRows) {
      pagesByCode.set(
        row.code,
        (pagesByCode.get(row.code) ?? new Set()).add(pageOfLine[row.index]!),
      );
    }
    for (const entry of ice) {
      for (const cited of pagesByCode.get(entry.code)!) {
        expect(entry.sourceRef, entry.entryKey).toContain(cited);
      }
    }
  });
});

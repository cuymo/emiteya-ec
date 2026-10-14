// Coherencia entre la matriz de casos especiales publicada y el motor (block-unsupported-special-
// cases-before-emission, design D7): ningún anexo figura como aplicado por el sistema si el motor no
// lo soporta, y ninguno soportado por el motor queda fuera de esas categorías. Evita que se repita
// el desajuste del anexo 24 (H-01 de la revisión normativa del go-live).
import { describe, expect, it } from "vitest";
import { DATASET_FILES } from "../../src/modules/catalogs/datasets/index.ts";
import { validateDatasets } from "../../src/modules/catalogs/domain/datasets.ts";
import {
  SPECIAL_CASE_DOCUMENT_TYPES,
  SUPPORTED_SPECIAL_CASES,
} from "../../src/modules/fiscal/domain/special-cases.ts";
import { SUPPORTED_CATEGORIES } from "../../src/modules/invoices/domain/evaluation.ts";

type MatrixEntry = Readonly<{ annex: number; category: string }>;

/** Anexos que dependen de una condición declarada del emisor y que la regla compartida conoce. */
const ISSUER_CONDITION_ANNEXES = Object.keys(SPECIAL_CASE_DOCUMENT_TYPES).map(Number);

/** Problemas de coherencia entre una matriz y el conjunto soportado por el motor. */
function consistencyProblems(
  matrix: readonly MatrixEntry[],
  supported: ReadonlySet<number>,
): string[] {
  const problems: string[] = [];
  for (const entry of matrix) {
    const advertised =
      SUPPORTED_CATEGORIES.has(entry.category) && ISSUER_CONDITION_ANNEXES.includes(entry.annex);
    if (advertised && !supported.has(entry.annex))
      problems.push(`el anexo ${entry.annex} figura como aplicado y el motor no lo soporta`);
    if (
      entry.category === "CONDITIONAL_ISSUER_RULE" &&
      !ISSUER_CONDITION_ANNEXES.includes(entry.annex)
    )
      problems.push(`el anexo ${entry.annex} es una condición del emisor que el motor no conoce`);
  }
  for (const annex of supported) {
    const entry = matrix.find((candidate) => candidate.annex === annex);
    if (!entry || !SUPPORTED_CATEGORIES.has(entry.category))
      problems.push(`el motor soporta el anexo ${annex} y la matriz no lo presenta como aplicado`);
  }
  return problems;
}

const latestMatrix = (): MatrixEntry[] => {
  const matrices = validateDatasets(DATASET_FILES).filter(
    (dataset) => dataset.catalogType === "special-case-matrix",
  );
  const latest = matrices.reduce((a, b) => (b.version > a.version ? b : a));
  return "entries" in latest ? latest.entries : [];
};

describe("coherencia de la matriz de casos especiales y el motor", () => {
  it("la última versión publicada coincide con lo que el motor soporta", () => {
    expect(consistencyProblems(latestMatrix(), SUPPORTED_SPECIAL_CASES)).toEqual([]);
  });

  it("el anexo 24 no figura como soportado ni en la matriz ni en el motor", () => {
    expect(SUPPORTED_SPECIAL_CASES.has(24)).toBe(false);
    expect(latestMatrix().find((entry) => entry.annex === 24)?.category).toBe("OUT_OF_MVP");
  });

  it("detecta el desajuste si el 24 vuelve al motor o a la condición del emisor", () => {
    const matrix = latestMatrix();
    expect(consistencyProblems(matrix, new Set([...SUPPORTED_SPECIAL_CASES, 24]))).toEqual([
      "el motor soporta el anexo 24 y la matriz no lo presenta como aplicado",
    ]);
    const regressed = matrix.map((entry) =>
      entry.annex === 24 ? { ...entry, category: "CONDITIONAL_ISSUER_RULE" } : entry,
    );
    expect(consistencyProblems(regressed, SUPPORTED_SPECIAL_CASES)).toEqual([
      "el anexo 24 figura como aplicado y el motor no lo soporta",
    ]);
  });
});

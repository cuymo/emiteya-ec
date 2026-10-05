// Cálculo único de los importes de la nota de débito (add-debit-notes, tarea 3.1, design D7): las
// bases de los conceptos se agrupan por tratamiento, el impuesto se materializa HALF_UP una vez
// sobre la base total de cada tratamiento y el valor total es el subtotal más los impuestos. Golden
// tests con valores calculados a mano y property tests con un generador determinista con semilla.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEBIT_NOTE_CALCULATION_VERSION,
  DebitNoteAmountError,
  calculateDebitNoteAmounts,
  type DebitConceptAmountInput,
} from "../../src/modules/debit-notes/domain/amounts.ts";
import type { InvoiceTaxTreatment } from "../../src/modules/debit-notes/domain/treatments.ts";
import {
  percentageOfExact,
  roundHalfUp,
  sumExact,
} from "../../src/platform/decimal/fiscal-decimal.ts";
import { EXEMPT, IVA_0, IVA_12, IVA_15, IVA_5, NOT_SUBJECT } from "./fixtures.ts";

const concept = (
  position: number,
  amount: string,
  treatment: InvoiceTaxTreatment,
): DebitConceptAmountInput => ({ position, amount, taxTreatment: treatment.key });

const calculate = (
  concepts: DebitConceptAmountInput[],
  treatments: InvoiceTaxTreatment[] = [IVA_0, IVA_5, IVA_12, IVA_15, NOT_SUBJECT, EXEMPT],
) => calculateDebitNoteAmounts({ concepts, treatments });

const taxesOf = (result: ReturnType<typeof calculate>) =>
  result.taxes.map(({ key, base, amount }) => [key, base, amount]);

describe("golden tests del cálculo de la nota de débito", () => {
  it("un concepto: 100.00 al 15 % → base 100.00, IVA 15.00, total 115.00", () => {
    const result = calculate([concept(1, "100.00", IVA_15)]);
    expect(result).toEqual({
      calculationVersion: DEBIT_NOTE_CALCULATION_VERSION,
      concepts: [{ position: 1, base: "100.00", taxTreatment: "2:4" }],
      taxes: [
        {
          key: "2:4",
          taxCode: "2",
          rateCode: "4",
          percentage: "15",
          base: "100.00",
          amount: "15.00",
        },
      ],
      withoutTaxes: "100.00",
      total: "115.00",
    });
  });

  it("varios conceptos de una tarifa: el impuesto se redondea una vez sobre la base del tratamiento", () => {
    const result = calculate([
      concept(1, "0.10", IVA_15),
      concept(2, "0.10", IVA_15),
      concept(3, "0.10", IVA_15),
    ]);
    // 0.30 × 15 % = 0.045 → 0.05. Por concepto serían 3 × 0.02 = 0.06: no se usa.
    expect(taxesOf(result)).toEqual([["2:4", "0.30", "0.05"]]);
    expect(result.withoutTaxes).toBe("0.30");
    expect(result.total).toBe("0.35");
    expect(result.concepts.map((c) => c.base)).toEqual(["0.10", "0.10", "0.10"]);
  });

  it("varias tarifas: 50.00 al 15 %, 20.00 al 0 % y 10.00 al 5 %", () => {
    const result = calculate([
      concept(1, "50.00", IVA_15),
      concept(2, "20.00", IVA_0),
      concept(3, "10.00", IVA_5),
    ]);
    expect(taxesOf(result)).toEqual([
      ["2:0", "20.00", "0.00"],
      ["2:4", "50.00", "7.50"],
      ["2:5", "10.00", "0.50"],
    ]);
    expect(result.withoutTaxes).toBe("80.00");
    expect(result.total).toBe("88.00");
  });

  it("decimales internos: 33.33 al 15 % → 5.00 y 0.03 al 15 % → 0.00", () => {
    expect(taxesOf(calculate([concept(1, "33.33", IVA_15)]))).toEqual([["2:4", "33.33", "5.00"]]);
    const small = calculate([concept(1, "0.03", IVA_15)]);
    expect(taxesOf(small)).toEqual([["2:4", "0.03", "0.00"]]);
    expect(small.total).toBe("0.03");
  });

  it("otra partición con la misma base por tratamiento da el mismo impuesto", () => {
    const partitions = [["0.10", "0.10", "0.10"], ["0.30"], ["0.15", "0.15"]];
    const results = partitions.map((amounts) =>
      calculate(amounts.map((amount, index) => concept(index + 1, amount, IVA_15))),
    );
    for (const result of results) {
      expect(taxesOf(result)).toEqual([["2:4", "0.30", "0.05"]]);
      expect(result.total).toBe("0.35");
    }
  });

  it("0 %, no objeto y exento son tres impuestos distintos con valor 0.00, sin agrupar", () => {
    const result = calculate([
      concept(1, "10.00", IVA_0),
      concept(2, "20.00", NOT_SUBJECT),
      concept(3, "30.00", EXEMPT),
    ]);
    expect(taxesOf(result)).toEqual([
      ["2:0", "10.00", "0.00"],
      ["2:6", "20.00", "0.00"],
      ["2:7", "30.00", "0.00"],
    ]);
    expect(result.total).toBe("60.00");
  });

  it("tarifa histórica: una factura con 12 % calcula al 12 %", () => {
    const result = calculate([concept(1, "100.00", IVA_12)], [IVA_12]);
    expect(taxesOf(result)).toEqual([["2:2", "100.00", "12.00"]]);
    expect(result.total).toBe("112.00");
  });

  it("los conceptos se mantienen en su orden y los impuestos se ordenan por código", () => {
    const result = calculate([
      concept(1, "5.00", IVA_15),
      concept(2, "1.00", IVA_0),
      concept(3, "2.00", IVA_15),
    ]);
    expect(result.concepts.map((c) => [c.position, c.base])).toEqual([
      [1, "5.00"],
      [2, "1.00"],
      [3, "2.00"],
    ]);
    expect(taxesOf(result)).toEqual([
      ["2:0", "1.00", "0.00"],
      ["2:4", "7.00", "1.05"],
    ]);
  });

  it("un importe entero toma la forma de dos decimales sin redondear", () => {
    expect(calculate([concept(1, "7", IVA_15)]).concepts[0]!.base).toBe("7.00");
    expect(calculate([concept(1, "7.5", IVA_15)]).concepts[0]!.base).toBe("7.50");
  });

  it("rechaza un tratamiento que la factura no tenía, un importe inválido y un exceso de dígitos", () => {
    const fails = (run: () => unknown) => {
      try {
        run();
        return null;
      } catch (error) {
        return error instanceof DebitNoteAmountError ? [error.code, error.concept] : error;
      }
    };
    expect(fails(() => calculate([concept(1, "10.00", IVA_12)], [IVA_15]))).toEqual([
      "TAX_TREATMENT_NOT_IN_INVOICE",
      1,
    ]);
    for (const amount of ["0", "0.00", "-1.00", "10.005", "abc"]) {
      expect(fails(() => calculate([concept(2, amount, IVA_15)]))).toEqual(["AMOUNT_INVALID", 2]);
    }
    // Dos conceptos dentro del dominio cuya suma ya no cabe en 14 dígitos.
    expect(
      fails(() =>
        calculate([concept(1, "999999999999.99", IVA_15), concept(2, "999999999999.99", IVA_15)]),
      ),
    ).toEqual(["AMOUNT_OUT_OF_RANGE", null]);
  });

  it("el módulo no usa number ni la librería decimal directamente", () => {
    const source = readFileSync(
      new URL("../../src/modules/debit-notes/domain/amounts.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /\b(Number|parseFloat|parseInt)\(|\.toNumber\(|toFixed|decimal\.js|new Decimal|\bDecimal\b/,
    );
  });
});

/** Generador determinista con semilla (mulberry32), como el de los benchmarks. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randomInt = (random: () => number, min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));
/** Importe de 2 decimales desde centavos enteros. */
const fromCents = (cents: number) => {
  const text = String(cents).padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
};
const twoDecimals = /^\d+\.\d{2}$/;

describe("property tests del cálculo de la nota de débito", () => {
  const TREATMENTS = [IVA_0, IVA_5, IVA_12, IVA_15, NOT_SUBJECT, EXEMPT];

  it("bases, impuestos y totales cumplen sus identidades en 500 notas aleatorias", () => {
    const random = mulberry32(0xd3b17);
    for (let run = 0; run < 500; run++) {
      const available = TREATMENTS.filter(() => random() < 0.6);
      const treatments = available.length > 0 ? available : [IVA_15];
      const count = randomInt(random, 1, 100);
      const concepts = Array.from({ length: count }, (_, index) => {
        // Importes de un centavo a un millón, con más masa en valores pequeños.
        const magnitude = randomInt(random, 0, 8);
        const cents = randomInt(random, 1, 10 ** magnitude);
        const target = treatments[randomInt(random, 0, treatments.length - 1)]!;
        return concept(index + 1, fromCents(cents), target);
      });
      const result = calculateDebitNoteAmounts({ concepts, treatments });

      expect(result.concepts.map((c) => c.base)).toEqual(
        concepts.map((c) => roundHalfUp(c.amount, 2)),
      );
      for (const tax of result.taxes) {
        const members = result.concepts.filter((c) => c.taxTreatment === tax.key);
        expect(tax.base).toBe(roundHalfUp(sumExact(members.map((m) => m.base)), 2));
        expect(tax.amount).toBe(roundHalfUp(percentageOfExact(tax.base, tax.percentage), 2));
      }
      expect(new Set(result.taxes.map((t) => t.key)).size).toBe(result.taxes.length);
      expect(result.withoutTaxes).toBe(
        roundHalfUp(sumExact(result.concepts.map((c) => c.base)), 2),
      );
      expect(result.withoutTaxes).toBe(roundHalfUp(sumExact(result.taxes.map((t) => t.base)), 2));
      expect(result.total).toBe(
        roundHalfUp(sumExact([result.withoutTaxes, ...result.taxes.map((t) => t.amount)]), 2),
      );
      const values = [
        ...result.concepts.map((c) => c.base),
        ...result.taxes.flatMap((t) => [t.base, t.amount]),
        result.withoutTaxes,
        result.total,
      ];
      for (const value of values) {
        expect(value).toMatch(twoDecimals);
      }
    }
  });

  it("cualquier repartición de los mismos totales por tratamiento da los mismos impuestos", () => {
    const random = mulberry32(0x5eed);
    for (let run = 0; run < 300; run++) {
      const totalCents = randomInt(random, 1, 5_000_000);
      const parts = randomInt(random, 1, Math.min(40, totalCents));
      // Reparte el total en `parts` importes positivos con cortes aleatorios.
      const cuts = new Set<number>();
      while (cuts.size < parts - 1) cuts.add(randomInt(random, 1, totalCents - 1));
      const bounds = [0, ...[...cuts].sort((a, b) => a - b), totalCents];
      const pieces = bounds.slice(1).map((bound, index) => bound - bounds[index]!);
      const split = calculate(
        pieces.map((cents, index) => concept(index + 1, fromCents(cents), IVA_15)),
      );
      const single = calculate([concept(1, fromCents(totalCents), IVA_15)]);
      expect(taxesOf(split)).toEqual(taxesOf(single));
      expect(split.total).toBe(single.total);
    }
  });

  it("el resultado no depende del orden de los conceptos, salvo el orden de los motivos", () => {
    const random = mulberry32(0x0bde);
    for (let run = 0; run < 200; run++) {
      const concepts = Array.from({ length: randomInt(random, 2, 30) }, (_, index) =>
        concept(
          index + 1,
          fromCents(randomInt(random, 1, 1_000_000)),
          [IVA_0, IVA_15, EXEMPT][randomInt(random, 0, 2)]!,
        ),
      );
      const shuffled = [...concepts].sort(() => random() - 0.5);
      const a = calculate(concepts);
      const b = calculate(shuffled);
      expect(a.taxes).toEqual(b.taxes);
      expect([a.withoutTaxes, a.total]).toEqual([b.withoutTaxes, b.total]);
    }
  });
});

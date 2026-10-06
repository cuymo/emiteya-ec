// Cálculo único de los valores retenidos (add-withholding-receipts, tarea 4.1, design D13): valor =
// base × porcentaje / 100, decimal exacto con HALF_UP a 2 decimales una sola vez por retención, y el
// total retenido como suma exacta. Golden tests calculados a mano y property tests con un generador
// determinista con semilla.
import { readFileSync } from "node:fs";
import { canonicalDecimal } from "@facturador/contracts";
import { describe, expect, it } from "vitest";
import {
  WITHHOLDING_CALCULATION_VERSION,
  WithholdingAmountError,
  calculateWithholdingAmounts,
  type WithholdingAmountInput,
} from "../../src/modules/withholding-receipts/domain/amounts.ts";
import {
  percentageOfExact,
  roundHalfUp,
  sumExact,
} from "../../src/platform/decimal/fiscal-decimal.ts";

const item = (
  base: string,
  percentage: string,
  support = 1,
  position = 1,
): WithholdingAmountInput => ({
  support,
  position,
  base,
  percentage,
});
const calculate = (items: WithholdingAmountInput[]) => calculateWithholdingAmounts({ items });
const fails = (run: () => unknown) => {
  try {
    run();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(WithholdingAmountError);
    const e = error as WithholdingAmountError;
    return [e.code, e.support, e.position];
  }
};

describe("golden tests del cálculo de la retención", () => {
  it("312C: 100.29 al 1.75 % → 1.76 (1.755075 con HALF_UP)", () => {
    expect(calculate([item("100.29", "1.75")])).toEqual({
      calculationVersion: WITHHOLDING_CALCULATION_VERSION,
      items: [{ support: 1, position: 1, base: "100.29", percentage: "1.75", amount: "1.76" }],
      withheld: "1.76",
    });
  });

  it("100.00 al 30 % → 30.00; 0.03 al 2 % → 0.00; la mitad sube: 0.25 al 2 % → 0.01", () => {
    expect(calculate([item("100.00", "30")]).items[0]?.amount).toBe("30.00");
    expect(calculate([item("0.03", "2")]).items[0]?.amount).toBe("0.00");
    expect(calculate([item("0.25", "2")]).items[0]?.amount).toBe("0.01");
    expect(calculate([item("0.24", "2")]).items[0]?.amount).toBe("0.00");
  });

  it("retención en cero (código 7): 0 % de cualquier base es 0.00, explícito", () => {
    expect(calculate([item("15.04", "0")]).items[0]).toEqual({
      support: 1,
      position: 1,
      base: "15.04",
      percentage: "0",
      amount: "0.00",
    });
  });

  it("IVA al 100 %: el valor es la base, y el total suma varias retenciones de varios documentos", () => {
    const result = calculate([
      item("15.04", "100", 1, 1),
      item("100.29", "1.75", 1, 2),
      item("200", "10", 2, 1),
      item("33.33", "70", 2, 2),
    ]);
    expect(
      result.items.map((i) => [i.support, i.position, i.base, i.percentage, i.amount]),
    ).toEqual([
      [1, 1, "15.04", "100", "15.04"],
      [1, 2, "100.29", "1.75", "1.76"],
      [2, 1, "200.00", "10", "20.00"],
      [2, 2, "33.33", "70", "23.33"],
    ]);
    expect(result.withheld).toBe("60.13");
  });

  it("el porcentaje queda en su forma canónica de 3 dígitos como máximo", () => {
    expect(calculate([item("10.00", "10.00")]).items[0]?.percentage).toBe("10");
    expect(calculate([item("10.00", "1.50")]).items[0]?.percentage).toBe("1.5");
    expect(calculate([item("10.00", "100.0")]).items[0]?.percentage).toBe("100");
  });

  it("rechaza una base no positiva o con 3 decimales y un porcentaje fuera de su dominio", () => {
    expect(fails(() => calculate([item("0", "2", 2, 3)]))).toEqual(["BASE_INVALID", 2, 3]);
    expect(fails(() => calculate([item("-1.00", "2")]))).toEqual(["BASE_INVALID", 1, 1]);
    expect(fails(() => calculate([item("1.005", "2")]))).toEqual(["BASE_INVALID", 1, 1]);
    expect(fails(() => calculate([item("1.00", "1000")]))).toEqual(["PERCENTAGE_INVALID", 1, 1]);
    expect(fails(() => calculate([item("1.00", "10.25")]))).toEqual(["PERCENTAGE_INVALID", 1, 1]);
    expect(fails(() => calculate([item("1.00", "-1")]))).toEqual(["PERCENTAGE_INVALID", 1, 1]);
  });

  it("un valor o un total que no cabe en 14 dígitos se rechaza sin redondear", () => {
    // Los dígitos se cuentan como se escriben: a 2 decimales, el máximo es 999999999999.99.
    expect(fails(() => calculate([item("99999999999999", "100", 3, 2)]))).toEqual([
      "AMOUNT_OUT_OF_RANGE",
      3,
      2,
    ]);
    expect(calculate([item("999999999999.99", "100")]).withheld).toBe("999999999999.99");
    expect(
      fails(() =>
        calculate([item("999999999999.99", "100", 1, 1), item("999999999999.99", "100", 1, 2)]),
      ),
    ).toEqual(["AMOUNT_OUT_OF_RANGE", null, null]);
  });

  it("el módulo no usa number ni la librería decimal directamente", () => {
    const source = readFileSync(
      new URL("../../src/modules/withholding-receipts/domain/amounts.ts", import.meta.url),
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
const fromCents = (cents: number) => {
  const text = String(cents).padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
};
const twoDecimals = /^\d+\.\d{2}$/;
// Porcentajes del catálogo vigente: renta (0 a 25) e IVA (0 a 100), con decimales como 1.75.
const PERCENTAGES = [
  "0",
  "1",
  "1.75",
  "2",
  "3",
  "5",
  "8",
  "10",
  "15",
  "20",
  "25",
  "30",
  "50",
  "70",
  "100",
];

describe("property tests del cálculo de la retención", () => {
  it("cada valor es el redondeo de la base por el porcentaje, y el total es su suma, en 500 retenciones", () => {
    const random = mulberry32(0x7e7e);
    for (let run = 0; run < 500; run++) {
      const supports = randomInt(random, 1, 10);
      const items: WithholdingAmountInput[] = [];
      for (let support = 1; support <= supports; support++) {
        for (let position = 1; position <= randomInt(random, 1, 5); position++) {
          const magnitude = randomInt(random, 0, 9);
          items.push(
            item(
              fromCents(randomInt(random, 1, 10 ** magnitude)),
              PERCENTAGES[randomInt(random, 0, PERCENTAGES.length - 1)]!,
              support,
              position,
            ),
          );
        }
      }
      const result = calculate(items);
      result.items.forEach((amount, index) => {
        const input = items[index]!;
        expect(amount.base).toBe(roundHalfUp(input.base, 2));
        expect(amount.percentage).toBe(canonicalDecimal(input.percentage));
        expect(amount.amount).toBe(roundHalfUp(percentageOfExact(input.base, input.percentage), 2));
        expect(amount.amount).toMatch(twoDecimals);
        expect(amount.amount.startsWith("-")).toBe(false);
      });
      expect(result.withheld).toBe(roundHalfUp(sumExact(result.items.map((i) => i.amount)), 2));
      expect(result.withheld).toMatch(twoDecimals);
    }
  });

  it("ningún valor supera su base cuando el porcentaje no supera 100", () => {
    const random = mulberry32(0xbeef);
    for (let run = 0; run < 300; run++) {
      const base = fromCents(randomInt(random, 1, 100_000_000));
      const percentage = PERCENTAGES[randomInt(random, 0, PERCENTAGES.length - 1)]!;
      const [amount] = calculate([item(base, percentage)]).items;
      expect(canonicalDecimal(sumExact([base, `-${amount!.amount}`])).startsWith("-")).toBe(false);
    }
  });
});

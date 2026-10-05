// Cálculo único de la nota de crédito (add-credit-notes, tarea 5.1, design D6): golden tests de los
// casos del design y property tests con un generador determinista con semilla sobre particiones de
// la cantidad, varias líneas y tarifas, y secuencias de notas con liberaciones. La invariante: al
// acreditar la totalidad, cada componente materializado de las notas vigentes suma exactamente el
// original, y ningún importe aceptado es negativo.
import { compareDecimalStrings } from "@facturador/contracts";
import { describe, expect, it } from "vitest";
import {
  CREDIT_NOTE_CALCULATION_VERSION,
  calculateCreditNoteAmounts,
  type CreditableLine,
  type CreditedLine,
  type CreditNoteAmounts,
  type CreditNoteLineAmounts,
} from "../../src/modules/credit-notes/domain/amounts.ts";
import { lineAmounts, invoiceTotals } from "../../src/modules/invoices/domain/amounts.ts";
import {
  divideRoundHalfUp,
  subtractExact,
  sumExact,
} from "../../src/platform/decimal/fiscal-decimal.ts";

const IVA15 = { taxCode: "2", rateCode: "4", percentage: "15" };
const IVA5 = { taxCode: "2", rateCode: "5", percentage: "5" };
const IVA0 = { taxCode: "2", rateCode: "0", percentage: "0" };

/** Línea de la factura calculada con la aritmética de la factura, como la guarda su snapshot. */
function invoiceLine(
  position: number,
  quantity: string,
  unitPrice: string,
  discount: string,
  rate = IVA15,
): CreditableLine {
  const amounts = lineAmounts({ quantity, unitPrice, discount, taxes: [rate] });
  return {
    position,
    quantity,
    unitPrice,
    subtotal: amounts.subtotal,
    discount: amounts.discount,
    taxableBase: amounts.taxableBase,
    taxes: amounts.taxes.map(({ taxCode, rateCode, percentage, amount }) => ({
      taxCode,
      rateCode,
      percentage,
      amount,
    })),
  };
}

const totalOf = (lines: readonly CreditableLine[]) =>
  invoiceTotals(
    lines.map((line) => ({
      subtotal: line.subtotal,
      discount: line.discount,
      taxableBase: line.taxableBase,
      taxes: line.taxes.map((tax) => ({ ...tax, base: line.taxableBase })),
    })),
  ).total;

/** Una nota sobre la factura con lo acreditado vigente; `reserved` es la suma de las vigentes. */
function credit(
  invoiceLines: readonly CreditableLine[],
  requested: readonly { position: number; quantity: string }[],
  active: readonly CreditNoteAmounts[] = [],
): CreditNoteAmounts {
  return calculateCreditNoteAmounts({
    invoiceLines,
    credited: active.flatMap((note) => note.lines.map(asCredited)),
    requested,
    invoice: {
      total: totalOf(invoiceLines),
      reserved: sumExact(active.map((note) => note.totals!.total)),
      applied: "0",
    },
  });
}

const asCredited = (line: CreditNoteLineAmounts): CreditedLine => ({
  position: line.position,
  quantity: line.quantity,
  subtotal: line.subtotal,
  discount: line.discount,
  taxableBase: line.taxableBase,
  taxes: line.taxes.map(({ taxCode, rateCode, amount }) => ({ taxCode, rateCode, amount })),
});

const summary = (note: CreditNoteAmounts) =>
  note.lines.map((line) => [line.quantity, line.discount, line.taxableBase, line.taxes[0]!.amount]);

describe("división exacta con HALF_UP", () => {
  it("redondea un cociente periódico una sola vez", () => {
    expect(divideRoundHalfUp("3", "3", 2)).toBe("1.00");
    expect(divideRoundHalfUp("10", "3", 2)).toBe("3.33");
    expect(divideRoundHalfUp("20", "3", 2)).toBe("6.67");
    expect(divideRoundHalfUp("0.005", "1", 2)).toBe("0.01");
    expect(divideRoundHalfUp("0.0049999999999999999999999999999999999999999", "1", 2)).toBe("0.00");
    expect(divideRoundHalfUp("2.99", "3", 2)).toBe("1.00");
    expect(divideRoundHalfUp("0", "7", 2)).toBe("0.00");
  });
});

describe("golden tests de design D6", () => {
  // Línea 3 × 10.00 con descuento 3.00 e IVA del 15 %: subtotal 30.00, base 27.00, IVA 4.05.
  const discounted = [invoiceLine(1, "3", "10.00", "3.00")];

  it("línea completa: iguales a los de la factura", () => {
    const note = credit(discounted, [{ position: 1, quantity: "3" }]);
    expect(note.calculationVersion).toBe(CREDIT_NOTE_CALCULATION_VERSION);
    expect(note.issues).toEqual([]);
    expect(summary(note)).toEqual([["3", "3.00", "27.00", "4.05"]]);
    expect(note.lines[0]!.unitPrice).toBe("10.00");
    expect(note.lines[0]!.subtotal).toBe("30");
    expect(note.totals).toEqual({
      withoutTaxes: "27.00",
      discount: "3.00",
      taxes: [{ ...IVA15, base: "27.00", amount: "4.05" }],
      total: "31.05",
    });
  });

  it("línea parcial: una unidad acredita descuento 1.00, base 9.00 e IVA 1.35", () => {
    const note = credit(discounted, [{ position: 1, quantity: "1" }]);
    expect(summary(note)).toEqual([["1", "1.00", "9.00", "1.35"]]);
    expect(note.capacity.lines).toEqual([
      { position: 1, original: "3", credited: "0", after: "1", remaining: "2" },
    ]);
  });

  it("tres notas de una unidad suman exactamente 27.00 y 4.05", () => {
    const first = credit(discounted, [{ position: 1, quantity: "1" }]);
    const second = credit(discounted, [{ position: 1, quantity: "1" }], [first]);
    const third = credit(discounted, [{ position: 1, quantity: "1" }], [first, second]);
    expect([summary(first), summary(second), summary(third)]).toEqual([
      [["1", "1.00", "9.00", "1.35"]],
      [["1", "1.00", "9.00", "1.35"]],
      [["1", "1.00", "9.00", "1.35"]],
    ]);
    expect(third.capacity.lines[0]!.remaining).toBe("0");
  });

  it("3 × 3.333333 sin descuento: bases 3.33, 3.34 y 3.33 con IVA 0.50 cada una", () => {
    const thirds = [invoiceLine(1, "3", "3.333333", "0.00")];
    expect([thirds[0]!.taxableBase, thirds[0]!.taxes[0]!.amount]).toEqual(["10.00", "1.50"]);
    const first = credit(thirds, [{ position: 1, quantity: "1" }]);
    const second = credit(thirds, [{ position: 1, quantity: "1" }], [first]);
    const third = credit(thirds, [{ position: 1, quantity: "1" }], [first, second]);
    expect(
      [first, second, third].map((n) => [n.lines[0]!.taxableBase, n.lines[0]!.taxes[0]!.amount]),
    ).toEqual([
      ["3.33", "0.50"],
      ["3.34", "0.50"],
      ["3.33", "0.50"],
    ]);
  });

  it("varias líneas con varias tarifas, agrupadas por código y tarifa", () => {
    const lines = [
      invoiceLine(1, "2", "8.75", "0.00", IVA15),
      invoiceLine(2, "4", "5.00", "2.00", IVA5),
      invoiceLine(3, "1", "20.00", "0.00", IVA0),
    ];
    const note = credit(lines, [
      { position: 3, quantity: "1" },
      { position: 1, quantity: "1" },
      { position: 2, quantity: "2" },
    ]);
    expect(note.issues).toEqual([]);
    expect(note.lines.map((line) => line.position)).toEqual([1, 2, 3]);
    expect(summary(note)).toEqual([
      ["1", "0.00", "8.75", "1.31"],
      ["2", "1.00", "9.00", "0.45"],
      ["1", "0.00", "20.00", "0.00"],
    ]);
    expect(note.totals).toEqual({
      withoutTaxes: "37.75",
      discount: "1.00",
      taxes: [
        { ...IVA0, base: "20.00", amount: "0.00" },
        { ...IVA15, base: "8.75", amount: "1.31" },
        { ...IVA5, base: "9.00", amount: "0.45" },
      ],
      total: "39.51",
    });
  });

  it("cantidades de 6 decimales: 0.333333 de una línea de 1.000000, sin redondeo intermedio", () => {
    const line = [invoiceLine(1, "1.000000", "30.00", "0.00")];
    const note = credit(line, [{ position: 1, quantity: "0.333333" }]);
    expect(note.lines[0]!.subtotal).toBe("9.99999");
    expect(summary(note)).toEqual([["0.333333", "0.00", "10.00", "1.50"]]);
    const rest = credit(line, [{ position: 1, quantity: "0.666667" }], [note]);
    expect(summary(rest)).toEqual([["0.666667", "0.00", "20.00", "3.00"]]);
  });

  it("remanente después de liberar una nota: la suma de las vigentes sigue siendo la línea", () => {
    const first = credit(discounted, [{ position: 1, quantity: "1" }]);
    const released = credit(discounted, [{ position: 1, quantity: "1" }], [first]);
    expect(released.issues).toEqual([]);
    // La segunda termina no autorizada: deja de contar y otra nota completa la línea.
    const completion = credit(discounted, [{ position: 1, quantity: "2" }], [first]);
    expect(summary(completion)).toEqual([["2", "2.00", "18.00", "2.70"]]);
    expect(sumExact([first.lines[0]!.taxableBase, completion.lines[0]!.taxableBase])).toBe("27");
  });

  it("una acumulación que excede la línea se rechaza indicando lo que queda", () => {
    const five = [invoiceLine(1, "5", "10.00", "0.00")];
    const first = credit(five, [{ position: 1, quantity: "3" }]);
    const excess = credit(five, [{ position: 1, quantity: "3" }], [first]);
    expect(excess.issues).toEqual([
      { code: "CREDIT_NOTE_QUANTITY_EXCEEDED", line: 1, remaining: "2" },
    ]);
    expect(excess.totals).toBeNull();
  });

  it("un descuento casi total con una cantidad mínima daría un importe negativo y se rechaza", () => {
    // 3 × 0.005 con descuento 0.01: base 0.01. La primera unidad acredita la base entera; la
    // segunda daría una base de -0.01.
    const tiny = [invoiceLine(1, "3", "0.005", "0.01")];
    const first = credit(tiny, [{ position: 1, quantity: "1" }]);
    expect(summary(first)).toEqual([["1", "0.00", "0.01", "0.00"]]);
    const negative = credit(tiny, [{ position: 1, quantity: "1" }], [first]);
    expect(negative.issues).toEqual([{ code: "CREDIT_NOTE_LINE_AMOUNT_NEGATIVE", line: 1 }]);
    // Completar la línea nunca es negativo: toma exactamente el remanente.
    const rest = credit(tiny, [{ position: 1, quantity: "2" }], [first]);
    expect(summary(rest)).toEqual([["2", "0.01", "0.00", "0.00"]]);
  });

  it("rechaza una línea ajena, repetida, en cero o con más de 6 decimales", () => {
    const note = credit(discounted, [
      { position: 2, quantity: "1" },
      { position: 1, quantity: "1" },
      { position: 1, quantity: "1" },
    ]);
    expect(note.issues).toEqual([
      { code: "CREDIT_NOTE_LINE_INVALID", line: 1 },
      { code: "CREDIT_NOTE_LINE_INVALID", line: 2 },
    ]);
    for (const quantity of ["0", "-1", "1.0000001"]) {
      expect(credit(discounted, [{ position: 1, quantity }]).issues).toEqual([
        { code: "CREDIT_NOTE_LINE_INVALID", line: 1 },
      ]);
    }
  });

  it("la anulación total copia la factura y su valor es exactamente el total", () => {
    const lines = [
      invoiceLine(1, "3", "8.75", "1.25", IVA15),
      invoiceLine(2, "1.5", "3.333333", "0.00", IVA5),
    ];
    const note = credit(
      lines,
      lines.map((line) => ({ position: line.position, quantity: line.quantity })),
    );
    expect(
      note.lines.map((l) => [l.subtotal, l.discount, l.taxableBase, l.taxes[0]!.amount]),
    ).toEqual(lines.map((l) => [l.subtotal, l.discount, l.taxableBase, l.taxes[0]!.amount]));
    expect(note.totals!.total).toBe(totalOf(lines));
    expect(note.capacity.total.remaining).toBe("0.00");
  });

  it("un crédito acumulado que excedería el total de la factura se rechaza", () => {
    const line = [invoiceLine(1, "2", "10.00", "0.00")];
    const note = calculateCreditNoteAmounts({
      invoiceLines: line,
      credited: [],
      requested: [{ position: 1, quantity: "1" }],
      invoice: { total: "23.00", reserved: "11.50", applied: "11.50" },
    });
    expect(note.issues).toEqual([{ code: "CREDIT_NOTE_AMOUNT_EXCEEDED", line: null }]);
    expect(note.totals).toBeNull();
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

/** Decimal aleatorio de hasta `scale` decimales en [min, max] unidades de 10^-scale. */
const randomUnits = (random: () => number, min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));
const fromUnits = (units: number, scale: number) => {
  const text = String(units).padStart(scale + 1, "0");
  return scale === 0 ? text : `${text.slice(0, -scale)}.${text.slice(-scale)}`;
};

/** Centavos enteros por debajo de un importe no negativo. */
const centsFloor = (value: string) => {
  const [integer = "0", fraction = ""] = value.split(".");
  return Number(integer) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
};

function randomInvoice(random: () => number): CreditableLine[] {
  const count = randomUnits(random, 1, 4);
  return Array.from({ length: count }, (_, index) => {
    const quantityScale = randomUnits(random, 0, 6);
    const quantityUnits = randomUnits(random, 1, 40 * 10 ** quantityScale);
    const priceScale = randomUnits(random, 0, 6);
    const priceUnits = randomUnits(random, 1, 200 * 10 ** priceScale);
    const quantity = fromUnits(quantityUnits, quantityScale);
    const unitPrice = fromUnits(priceUnits, priceScale);
    const rate = [IVA15, IVA5, IVA0][randomUnits(random, 0, 2)]!;
    // Descuento de 2 decimales entre 0 y el subtotal; a veces total.
    const subtotalCents = centsFloor(
      lineAmounts({ quantity, unitPrice, discount: "0", taxes: [] }).subtotal,
    );
    const discountCents =
      random() < 0.3 ? 0 : random() < 0.2 ? subtotalCents : randomUnits(random, 0, subtotalCents);
    return invoiceLine(index + 1, quantity, unitPrice, fromUnits(discountCents, 2), rate);
  });
}

/** Partición aleatoria de la cantidad restante: una pieza positiva de hasta 6 decimales. */
function randomPiece(random: () => number, remaining: string): string {
  const scale = 6;
  const [integer = "0", fraction = ""] = remaining.split(".");
  const remainingUnits = Number(integer) * 10 ** scale + Number(fraction.padEnd(scale, "0"));
  if (random() < 0.25 || remainingUnits <= 1) return remaining;
  return fromUnits(randomUnits(random, 1, remainingUnits), scale);
}

describe("property tests de particiones (design D6)", () => {
  it("con notas parciales y liberaciones, la totalidad acreditada suma exactamente cada componente original", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const random = mulberry32(seed);
      const lines = randomInvoice(random);
      let active: CreditNoteAmounts[] = [];
      let guard = 0;
      // Cada línea se acredita en notas sucesivas hasta completarla; algunas notas se liberan.
      for (;;) {
        const credited = (position: number) =>
          sumExact(
            active.flatMap((n) =>
              n.lines.filter((l) => l.position === position).map((l) => l.quantity),
            ),
          );
        const open = lines.filter(
          (line) => compareDecimalStrings(credited(line.position), line.quantity) < 0,
        );
        if (open.length === 0) break;
        expect(++guard, `semilla ${seed}: demasiadas notas`).toBeLessThan(200);
        const chosen = open.filter(() => random() < 0.7);
        const targetsOf = (chosen.length > 0 ? chosen : open).map((line) => ({
          position: line.position,
          quantity: randomPiece(random, subtractExact(line.quantity, credited(line.position))),
        }));
        let note = credit(lines, targetsOf, active);
        if (note.issues.some((issue) => issue.code === "CREDIT_NOTE_LINE_AMOUNT_NEGATIVE")) {
          // El usuario completa la línea: nunca es negativo porque toma el remanente.
          note = credit(
            lines,
            targetsOf.map((t) => {
              const line = lines.find((l) => l.position === t.position)!;
              return {
                position: t.position,
                quantity: subtractExact(line.quantity, credited(t.position)),
              };
            }),
            active,
          );
        }
        expect(note.issues, `semilla ${seed}`).toEqual([]);
        for (const line of note.lines) {
          for (const value of [
            line.subtotal,
            line.discount,
            line.taxableBase,
            ...line.taxes.map((t) => t.amount),
          ]) {
            expect(
              compareDecimalStrings(value, "0"),
              `semilla ${seed}: importe negativo`,
            ).toBeGreaterThanOrEqual(0);
          }
        }
        // Una de cada cinco notas termina devuelta o no autorizada y deja de contar.
        if (random() >= 0.2) active = [...active, note];
      }
      for (const line of lines) {
        const notes = active.flatMap((n) => n.lines.filter((l) => l.position === line.position));
        const sum = (pick: (l: CreditNoteLineAmounts) => string) => sumExact(notes.map(pick));
        expect(
          [
            sum((l) => l.quantity),
            sum((l) => l.subtotal),
            sum((l) => l.discount),
            sum((l) => l.taxableBase),
            sum((l) => l.taxes[0]!.amount),
          ].map((value) => sumExact([value, "0"])),
          `semilla ${seed}, línea ${line.position}`,
        ).toEqual(
          [
            line.quantity,
            line.subtotal,
            line.discount,
            line.taxableBase,
            line.taxes[0]!.amount,
          ].map((value) => sumExact([value, "0"])),
        );
      }
      // El valor de las notas vigentes suma exactamente el total de la factura.
      expect(sumExact(active.map((note) => note.totals!.total)), `semilla ${seed}`).toBe(
        sumExact([totalOf(lines), "0"]),
      );
    }
  });
});

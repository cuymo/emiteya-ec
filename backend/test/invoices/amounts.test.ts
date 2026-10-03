// Importes de la factura (add-invoice-emission, design D5; Q-14): exactos, HALF_UP solo en la base
// de línea, su impuesto y los totales, y totales desde los valores ya materializados. Los valores
// esperados de la tabla dorada se calcularon aparte, no con este módulo: son los de la spec y los
// de la parte offline de S-3. Un cambio en cualquiera de ellos es un cambio de política.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  InvoiceAmountError,
  invoiceTotals,
  lineAmounts,
  lineDiscount,
  lineSubtotal,
  materializeMoney,
  taxAmount,
  taxableBase,
  type LineTaxRate,
} from "../../src/modules/invoices/domain/amounts.ts";

const IVA_0: LineTaxRate = { taxCode: "2", rateCode: "0", percentage: "0" };
const IVA_5: LineTaxRate = { taxCode: "2", rateCode: "5", percentage: "5" };
const IVA_13: LineTaxRate = { taxCode: "2", rateCode: "10", percentage: "13" };
const IVA_15: LineTaxRate = { taxCode: "2", rateCode: "4", percentage: "15" };

type GoldenLine = readonly [quantity: string, unitPrice: string, discount: string, LineTaxRate];
type GoldenCase = {
  name: string;
  lines: readonly GoldenLine[];
  /** Base y valor del impuesto de cada línea. */
  perLine: readonly (readonly [string, string])[];
  withoutTaxes: string;
  discount: string;
  /** Código de tarifa, base y valor, en orden de código. */
  taxes: readonly (readonly [string, string, string])[];
  total: string;
};

const GOLDEN: readonly GoldenCase[] = [
  {
    name: "spec: empates HALF_UP",
    lines: [
      ["1", "1.005", "0", IVA_5],
      ["1", "0.10", "0", IVA_15],
    ],
    perLine: [
      ["1.01", "0.05"],
      ["0.10", "0.02"],
    ],
    withoutTaxes: "1.11",
    discount: "0.00",
    taxes: [
      ["4", "0.10", "0.02"],
      ["5", "1.01", "0.05"],
    ],
    total: "1.18",
  },
  {
    name: "spec: totales desde valores materializados (no el 15 % de 0.30)",
    lines: [
      ["1", "0.10", "0", IVA_15],
      ["1", "0.10", "0", IVA_15],
      ["1", "0.10", "0", IVA_15],
    ],
    perLine: [
      ["0.10", "0.02"],
      ["0.10", "0.02"],
      ["0.10", "0.02"],
    ],
    withoutTaxes: "0.30",
    discount: "0.00",
    taxes: [["4", "0.30", "0.06"]],
    total: "0.36",
  },
  {
    name: "spec y S-3: varias líneas con descuento",
    lines: [
      ["3", "8.75", "1.25", IVA_15],
      ["1.5", "0.015", "0", IVA_15],
      ["2.5", "0.01", "0", IVA_0],
      ["1", "1.005", "0", IVA_5],
      ["1", "0.10", "0", IVA_15],
      ["3", "0.333333", "0", IVA_15],
    ],
    perLine: [
      ["25.00", "3.75"],
      ["0.02", "0.00"],
      ["0.03", "0.00"],
      ["1.01", "0.05"],
      ["0.10", "0.02"],
      ["1.00", "0.15"],
    ],
    withoutTaxes: "27.16",
    discount: "1.25",
    taxes: [
      ["0", "0.03", "0.00"],
      ["4", "26.12", "3.92"],
      ["5", "1.01", "0.05"],
    ],
    total: "31.13",
  },
  {
    name: "S-3: consumidor final 49.99",
    lines: [["1", "43.47", "0", IVA_15]],
    perLine: [["43.47", "6.52"]],
    withoutTaxes: "43.47",
    discount: "0.00",
    taxes: [["4", "43.47", "6.52"]],
    total: "49.99",
  },
  {
    name: "S-3: consumidor final 50.00",
    lines: [["1", "43.48", "0", IVA_15]],
    perLine: [["43.48", "6.52"]],
    withoutTaxes: "43.48",
    discount: "0.00",
    taxes: [["4", "43.48", "6.52"]],
    total: "50.00",
  },
  {
    name: "S-3: consumidor final 50.01 (el rechazo es de la validación)",
    lines: [["1", "43.49", "0", IVA_15]],
    perLine: [["43.49", "6.52"]],
    withoutTaxes: "43.49",
    discount: "0.00",
    taxes: [["4", "43.49", "6.52"]],
    total: "50.01",
  },
  {
    name: "S-3: valores grandes",
    lines: [["999999.999999", "1.000001", "0", IVA_15]],
    perLine: [["1000001.00", "150000.15"]],
    withoutTaxes: "1000001.00",
    discount: "0.00",
    taxes: [["4", "1000001.00", "150000.15"]],
    total: "1150001.15",
  },
  {
    name: "S-3: regresiones de 18 y 17 dígitos como precio",
    lines: [
      ["1", "123456789012.123456", "0", IVA_15],
      ["1", "99999999999.999999", "0", IVA_15],
    ],
    perLine: [
      ["123456789012.12", "18518518351.82"],
      ["100000000000.00", "15000000000.00"],
    ],
    withoutTaxes: "223456789012.12",
    discount: "0.00",
    taxes: [["4", "223456789012.12", "33518518351.82"]],
    total: "256975307363.94",
  },
  {
    name: "S-3: regresiones de 18 y 17 dígitos como cantidad",
    lines: [
      ["123456789012.123456", "1", "0", IVA_15],
      ["99999999999.999999", "1", "0", IVA_15],
    ],
    perLine: [
      ["123456789012.12", "18518518351.82"],
      ["100000000000.00", "15000000000.00"],
    ],
    withoutTaxes: "223456789012.12",
    discount: "0.00",
    taxes: [["4", "223456789012.12", "33518518351.82"]],
    total: "256975307363.94",
  },
  {
    name: "descuento igual al subtotal y tarifa del 13 %",
    lines: [
      ["2", "1", "2.00", IVA_15],
      ["2", "1", "0", IVA_13],
    ],
    perLine: [
      ["0.00", "0.00"],
      ["2.00", "0.26"],
    ],
    withoutTaxes: "2.00",
    discount: "2.00",
    taxes: [
      ["4", "0.00", "0.00"],
      ["10", "2.00", "0.26"],
    ],
    total: "2.26",
  },
];

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof InvoiceAmountError
      ? `${error.code}:${error.field}`
      : `otro: ${String(error)}`;
  }
};

describe("importes de la factura (design D5, Q-14)", () => {
  describe("tabla dorada", () => {
    for (const golden of GOLDEN) {
      it(golden.name, () => {
        const lines = golden.lines.map(([quantity, unitPrice, discount, rate]) =>
          lineAmounts({ quantity, unitPrice, discount, taxes: [rate] }),
        );
        expect(lines.map((line) => [line.taxableBase, line.taxes[0]!.amount])).toEqual(
          golden.perLine,
        );
        const totals = invoiceTotals(lines);
        expect(totals.withoutTaxes).toBe(golden.withoutTaxes);
        expect(totals.discount).toBe(golden.discount);
        expect(totals.taxes.map((tax) => [tax.rateCode, tax.base, tax.amount])).toEqual(
          golden.taxes,
        );
        expect(totals.total).toBe(golden.total);
      });
    }
  });

  it("el subtotal de línea es exacto y no se redondea", () => {
    expect(lineSubtotal("3", "0.333333")).toBe("0.999999");
    expect(lineSubtotal("1.5", "0.015")).toBe("0.0225");
    expect(lineSubtotal("123456789012.123456", "999999.999999")).toBe(
      "123456789011999999.210987876544",
    );
  });

  it("materializa HALF_UP a 2 decimales, también en los empates", () => {
    for (const [exact, money] of [
      ["0.005", "0.01"],
      ["0.015", "0.02"],
      ["0.025", "0.03"],
      ["1.005", "1.01"],
      ["0.0225", "0.02"],
      ["0.999999", "1.00"],
      ["2.344", "2.34"],
      ["25", "25.00"],
    ] as const) {
      expect(materializeMoney(exact, "total"), exact).toBe(money);
    }
  });

  it("la base es el subtotal exacto menos el descuento; el impuesto se calcula sobre la base materializada", () => {
    expect(taxableBase("26.25", "1.25")).toBe("25.00");
    expect(taxableBase("0.0225", "0.02")).toBe("0.00");
    // 5 % de la base materializada 1.01 = 0.0505 → 0.05; el 5 % de 1.005 sería 0.05025.
    expect(taxAmount("1.01", "5")).toBe("0.05");
    expect(taxAmount("0.30", "15")).toBe("0.05");
  });

  it("el descuento es un importe de 2 decimales entre 0 y el subtotal exacto, sin redondear", () => {
    expect(lineDiscount("1.25", "26.25")).toBe("1.25");
    expect(lineDiscount("26.25", "26.25")).toBe("26.25");
    expect(lineDiscount("0", "1")).toBe("0.00");
    expect(lineDiscount("0.02", "0.0225")).toBe("0.02");
    expect(codeOf(() => lineDiscount("0.03", "0.0225"))).toBe("DISCOUNT_EXCEEDS_SUBTOTAL:discount");
    expect(codeOf(() => lineDiscount("26.26", "26.25"))).toBe("DISCOUNT_EXCEEDS_SUBTOTAL:discount");
    for (const invalid of ["-1", "1.255", "1e1", "1,5", "100000000000000"]) {
      expect(
        codeOf(() => lineDiscount(invalid, "26.25")),
        invalid,
      ).toBe("AMOUNT_INVALID:discount");
    }
  });

  it("rechaza entradas fuera de su especificación sin redondearlas", () => {
    const line = { quantity: "1", unitPrice: "1", discount: "0", taxes: [IVA_15] };
    expect(codeOf(() => lineAmounts({ ...line, quantity: "1.0000001" }))).toBe(
      "AMOUNT_INVALID:quantity",
    );
    expect(codeOf(() => lineAmounts({ ...line, unitPrice: "1234567890123.123456" }))).toBe(
      "AMOUNT_INVALID:unitPrice",
    );
    expect(
      codeOf(() => lineAmounts({ ...line, taxes: [{ ...IVA_15, percentage: "15.001" }] })),
    ).toBe("AMOUNT_INVALID:rate");
  });

  it("un importe materializado que no cabe en el XSD es AMOUNT_OUT_OF_RANGE", () => {
    const max = "999999999999.999999";
    expect(
      codeOf(() => lineAmounts({ quantity: max, unitPrice: max, discount: "0", taxes: [IVA_15] })),
    ).toBe("AMOUNT_OUT_OF_RANGE:taxableBase");
    // La base cabe (999999999999.99) y el total sin impuestos de dos líneas no.
    const full = lineAmounts({
      quantity: "1",
      unitPrice: "999999999999.99",
      discount: "0",
      taxes: [IVA_0],
    });
    expect(codeOf(() => invoiceTotals([full, full]))).toBe("AMOUNT_OUT_OF_RANGE:taxTotalBase");
    // Base y tarifa caben; el importe total con el IVA no.
    const big = lineAmounts({
      quantity: "1",
      unitPrice: "900000000000",
      discount: "0",
      taxes: [IVA_15],
    });
    expect(big.taxes[0]!.amount).toBe("135000000000.00");
    expect(codeOf(() => invoiceTotals([big]))).toBe("AMOUNT_OUT_OF_RANGE:total");
    expect(materializeMoney("999999999999.994", "total")).toBe("999999999999.99");
    expect(codeOf(() => materializeMoney("999999999999.995", "total"))).toBe(
      "AMOUNT_OUT_OF_RANGE:total",
    );
  });

  it("dos porcentajes para la misma tarifa en una factura son un error de programación", () => {
    const a = lineAmounts({ quantity: "1", unitPrice: "1", discount: "0", taxes: [IVA_15] });
    const b = lineAmounts({
      quantity: "1",
      unitPrice: "1",
      discount: "0",
      taxes: [{ ...IVA_15, percentage: "12" }],
    });
    expect(() => invoiceTotals([a, b])).toThrow("dos porcentajes");
  });

  it("el módulo no usa number ni la librería decimal directamente", () => {
    const source = readFileSync(
      new URL("../../src/modules/invoices/domain/amounts.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /\b(Number|parseFloat|parseInt)\(|\.toNumber\(|toFixed|decimal\.js|new Decimal|\bDecimal\b/,
    );
  });
});

// Cálculo único de la liquidación de compra (add-purchase-settlements, tarea 4.2, design D8): los
// importes del spec, el redondeo HALF_UP en sus tres puntos, los seis decimales exactos, el 0 %, no
// objeto y exento con su código propio, y el importe fuera del rango del XSD. Sin `number`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DocumentAmountError } from "../../src/modules/fiscal/domain/document-amounts.ts";
import {
  PURCHASE_SETTLEMENT_CALCULATION_VERSION,
  calculatePurchaseSettlementAmounts,
  purchaseSettlementLineAmounts,
} from "../../src/modules/purchase-settlements/domain/amounts.ts";

const IVA_15 = { rateCode: "4", percentage: "15" };
const IVA_0 = { rateCode: "0", percentage: "0" };
const NOT_SUBJECT = { rateCode: "6", percentage: "0" };
const EXEMPT = { rateCode: "7", percentage: "0" };

describe("cálculo de la liquidación de compra (design D8)", () => {
  it("los totales del spec: 10 × 4.50 − 5.00 al 15 % y 2 × 30.00 al 0 %", () => {
    const amounts = calculatePurchaseSettlementAmounts([
      { position: 1, quantity: "10", unitPrice: "4.50", discount: "5.00", rate: IVA_15 },
      { position: 2, quantity: "2", unitPrice: "30.00", discount: "0", rate: IVA_0 },
    ]);
    expect(amounts.calculationVersion).toBe("purchase-settlement-amounts-1");
    expect(PURCHASE_SETTLEMENT_CALCULATION_VERSION).toBe("purchase-settlement-amounts-1");
    expect(amounts.lines.map((line) => [line.taxableBase, line.tax.amount])).toEqual([
      ["40.00", "6.00"],
      ["60.00", "0.00"],
    ]);
    expect(amounts.totals).toEqual({
      withoutTaxes: "100.00",
      discount: "5.00",
      taxes: [
        { taxCode: "2", rateCode: "0", percentage: "0", base: "60.00", amount: "0.00" },
        { taxCode: "2", rateCode: "4", percentage: "15", base: "40.00", amount: "6.00" },
      ],
      total: "106.00",
    });
  });

  it("seis decimales exactos: la base sale del producto exacto y se redondea una sola vez", () => {
    const line = purchaseSettlementLineAmounts({
      position: 1,
      quantity: "1.333333",
      unitPrice: "3.000003",
      discount: "0",
      rate: IVA_15,
    });
    // 1.333333 × 3.000003 = 4.000002999999; la base es 4.00 y el IVA, 15 % de 4.00.
    expect(line.subtotal).toBe("4.000002999999");
    expect(line.taxableBase).toBe("4.00");
    expect(line.tax.amount).toBe("0.60");
  });

  it("HALF_UP en la base, en el IVA de la línea y en los totales, nunca en valores intermedios", () => {
    // Base 0.125 → 0.13; IVA 15 % de 0.13 = 0.0195 → 0.02.
    const half = purchaseSettlementLineAmounts({
      position: 1,
      quantity: "1",
      unitPrice: "0.125",
      discount: "0",
      rate: IVA_15,
    });
    expect([half.taxableBase, half.tax.amount]).toEqual(["0.13", "0.02"]);
    // Tres líneas de 0.10 al 15 %: cada IVA es 0.02 (0.015 → 0.02) y el total suma los
    // materializados (0.06), no el 15 % de 0.30 (0.05).
    const amounts = calculatePurchaseSettlementAmounts(
      [1, 2, 3].map((position) => ({
        position,
        quantity: "1",
        unitPrice: "0.10",
        discount: "0",
        rate: IVA_15,
      })),
    );
    expect(amounts.totals.taxes).toEqual([
      { taxCode: "2", rateCode: "4", percentage: "15", base: "0.30", amount: "0.06" },
    ]);
    expect(amounts.totals.total).toBe("0.36");
  });

  it("el 0 %, no objeto y exento tienen su código propio y su base separada", () => {
    const amounts = calculatePurchaseSettlementAmounts([
      { position: 1, quantity: "1", unitPrice: "10", discount: "0", rate: IVA_0 },
      { position: 2, quantity: "1", unitPrice: "20", discount: "0", rate: NOT_SUBJECT },
      { position: 3, quantity: "1", unitPrice: "30", discount: "0", rate: EXEMPT },
    ]);
    expect(amounts.totals.taxes.map((tax) => [tax.rateCode, tax.base, tax.amount])).toEqual([
      ["0", "10.00", "0.00"],
      ["6", "20.00", "0.00"],
      ["7", "30.00", "0.00"],
    ]);
    expect(amounts.totals.total).toBe("60.00");
  });

  it("un descuento mayor que el subtotal o un importe fuera del XSD se rechazan", () => {
    const codeOf = (work: () => unknown) => {
      try {
        work();
        return null;
      } catch (error) {
        return error instanceof DocumentAmountError ? error.code : String(error);
      }
    };
    expect(
      codeOf(() =>
        purchaseSettlementLineAmounts({
          position: 1,
          quantity: "1",
          unitPrice: "1",
          discount: "1.01",
          rate: IVA_15,
        }),
      ),
    ).toBe("DISCOUNT_EXCEEDS_SUBTOTAL");
    expect(
      codeOf(() =>
        purchaseSettlementLineAmounts({
          position: 1,
          quantity: "999999999999",
          unitPrice: "999999",
          discount: "0",
          rate: IVA_15,
        }),
      ),
    ).toBe("AMOUNT_OUT_OF_RANGE");
    // Cada base cabe; el total con el IVA no.
    expect(
      codeOf(() =>
        calculatePurchaseSettlementAmounts([
          { position: 1, quantity: "1", unitPrice: "99999999999999", discount: "0", rate: IVA_15 },
        ]),
      ),
    ).toBe("AMOUNT_OUT_OF_RANGE");
  });

  it("el módulo no usa number ni la librería decimal, y no importa la factura", () => {
    const source = readFileSync(
      new URL("../../src/modules/purchase-settlements/domain/amounts.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /\b(Number|parseFloat|parseInt)\(|\.toNumber\(|toFixed|decimal\.js|new Decimal|\bDecimal\b/,
    );
    expect(source).not.toMatch(/modules\/invoices|invoices\/domain/);
  });
});

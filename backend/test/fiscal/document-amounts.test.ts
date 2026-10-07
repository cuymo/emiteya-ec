// Primitivas de importes compartidas (add-purchase-settlements, tarea 1.2, design D8): el módulo fiscal
// neutral es el mismo cálculo que la factura usaba, sin `number` ni dependencias de un comprobante. La
// factura las sigue usando con sus nombres; sus pruebas de importes, su contrato de regresión y sus
// golden no cambian (`test/invoices/amounts.test.ts`).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DocumentAmountError,
  documentTotals,
  lineAmounts,
} from "../../src/modules/fiscal/domain/document-amounts.ts";
import { InvoiceAmountError, invoiceTotals } from "../../src/modules/invoices/domain/amounts.ts";

const IVA_15 = { taxCode: "2", rateCode: "4", percentage: "15" } as const;
const IVA_0 = { taxCode: "2", rateCode: "0", percentage: "0" } as const;

describe("primitivas de importes compartidas (design D8)", () => {
  it("la factura usa las mismas funciones y el mismo error", () => {
    expect(invoiceTotals).toBe(documentTotals);
    expect(InvoiceAmountError).toBe(DocumentAmountError);
  });

  it("calcula una línea y los totales con los tres puntos de materialización HALF_UP", () => {
    const a = lineAmounts({ quantity: "10", unitPrice: "4.5", discount: "5", taxes: [IVA_15] });
    const b = lineAmounts({ quantity: "2", unitPrice: "30", discount: "0", taxes: [IVA_0] });
    expect(a).toMatchObject({ subtotal: "45", discount: "5.00", taxableBase: "40.00" });
    expect(a.taxes).toEqual([{ ...IVA_15, base: "40.00", amount: "6.00" }]);
    expect(documentTotals([a, b])).toEqual({
      withoutTaxes: "100.00",
      discount: "5.00",
      taxes: [
        { ...IVA_0, base: "60.00", amount: "0.00" },
        { ...IVA_15, base: "40.00", amount: "6.00" },
      ],
      total: "106.00",
    });
  });

  it("un descuento mayor que el subtotal es DISCOUNT_EXCEEDS_SUBTOTAL", () => {
    expect(() =>
      lineAmounts({ quantity: "1", unitPrice: "1", discount: "1.01", taxes: [IVA_15] }),
    ).toThrow(DocumentAmountError);
  });

  it("el módulo no usa number ni la librería decimal, y no importa ningún comprobante", () => {
    const source = readFileSync(
      new URL("../../src/modules/fiscal/domain/document-amounts.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /\b(Number|parseFloat|parseInt)\(|\.toNumber\(|toFixed|decimal\.js|new Decimal|\bDecimal\b/,
    );
    expect(source).not.toMatch(
      /modules\/(invoices|credit-notes|debit-notes|withholding-receipts|shipping-guides|purchase-settlements)/,
    );
    expect(source).not.toMatch(/from "\.\.\/\.\.\/(?!\.\.\/platform)/);
  });
});

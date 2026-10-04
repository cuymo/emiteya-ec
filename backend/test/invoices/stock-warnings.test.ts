// Avisos de existencias del borrador (add-minimal-inventory, design D9): suma exacta por producto,
// solo los productos marcados, y sin inventario nunca como saldo cero.
import { describe, expect, it } from "vitest";
import type {
  EvaluationInput,
  EvaluationProduct,
} from "../../src/modules/invoices/domain/evaluation.ts";
import {
  requestedByProduct,
  stockWarnings,
} from "../../src/modules/invoices/domain/stock-warnings.ts";

const product = (id: string, stockTracked: boolean) =>
  ({ id, stockTracked }) as unknown as EvaluationProduct;

function inputOf(
  lines: { productId: string; quantity: string }[],
  products: EvaluationProduct[],
  balances: [string, string][],
): EvaluationInput {
  return {
    draft: { lines: lines.map((line) => ({ ...line, discount: "0" })) },
    products: new Map(products.map((item) => [item.id, item])),
    stockBalances: new Map(balances),
  } as unknown as EvaluationInput;
}

describe("avisos de existencias del borrador", () => {
  it("la cantidad pedida suma exactamente las líneas del mismo producto", () => {
    expect(
      requestedByProduct([
        { productId: "p-a", quantity: "3" },
        { productId: "p-a", quantity: "4" },
        { productId: "p-b", quantity: "0.1" },
        { productId: "p-b", quantity: "0.2" },
      ]),
    ).toEqual(
      new Map([
        ["p-a", "7"],
        ["p-b", "0.3"],
      ]),
    );
  });

  it("avisa la suma sobre el saldo, y sin inventario sin saldo", () => {
    const warnings = stockWarnings(
      inputOf(
        [
          { productId: "p-a", quantity: "3" },
          { productId: "p-a", quantity: "4" },
          { productId: "p-b", quantity: "1" },
          { productId: "p-c", quantity: "5" },
          { productId: "p-d", quantity: "8" },
        ],
        [product("p-a", true), product("p-b", true), product("p-c", true), product("p-d", false)],
        [
          ["p-a", "5"],
          ["p-c", "5"],
        ],
      ),
    );
    expect(warnings).toEqual([
      { code: "STOCK_BELOW_REQUESTED", productId: "p-a", requested: "7", balance: "5" },
      { code: "STOCK_NOT_INITIALIZED", productId: "p-b", requested: "1", balance: null },
    ]);
  });

  it("un saldo negativo avisa cualquier cantidad pedida", () => {
    expect(
      stockWarnings(
        inputOf([{ productId: "p-a", quantity: "0.5" }], [product("p-a", true)], [["p-a", "-2"]]),
      ),
    ).toEqual([
      { code: "STOCK_BELOW_REQUESTED", productId: "p-a", requested: "0.5", balance: "-2" },
    ]);
  });
});

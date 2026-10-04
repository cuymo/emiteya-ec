// Avisos de existencias de la vista previa del borrador (add-minimal-inventory, design D9): aparte de
// los `issues`, nunca bloquean la emisión ni garantizan disponibilidad. Se calculan con los saldos
// leídos junto con la evaluación; la emisión no los consulta.
import { canonicalDecimal, compareDecimalStrings, type StockWarning } from "@facturador/contracts";
import { sumExact } from "../../../platform/decimal/fiscal-decimal.ts";
import type { EvaluationInput } from "./evaluation.ts";

/** Cantidad pedida de cada producto de un borrador: la suma exacta de sus líneas. */
export function requestedByProduct(
  lines: readonly Readonly<{ productId: string; quantity: string }>[],
): Map<string, string> {
  const byProduct = new Map<string, string[]>();
  for (const line of lines) {
    byProduct.set(line.productId, [...(byProduct.get(line.productId) ?? []), line.quantity]);
  }
  return new Map(
    [...byProduct.entries()].map(([productId, quantities]) => [
      productId,
      canonicalDecimal(sumExact(quantities)),
    ]),
  );
}

/**
 * Un aviso por producto marcado del borrador: sin inventario, `STOCK_NOT_INITIALIZED` sin saldo
 * (nunca cero); con la suma de sus líneas sobre el saldo, `STOCK_BELOW_REQUESTED`.
 */
export function stockWarnings(input: EvaluationInput): StockWarning[] {
  const tracked = input.draft.lines.filter(
    (line) => input.products.get(line.productId)?.stockTracked === true,
  );
  const warnings: StockWarning[] = [];
  for (const [productId, requested] of requestedByProduct(tracked)) {
    const balance = input.stockBalances.get(productId);
    if (balance === undefined) {
      warnings.push({ code: "STOCK_NOT_INITIALIZED", productId, requested, balance: null });
    } else if (compareDecimalStrings(requested, balance) > 0) {
      warnings.push({ code: "STOCK_BELOW_REQUESTED", productId, requested, balance });
    }
  }
  return warnings;
}

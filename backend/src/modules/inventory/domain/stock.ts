// Dominio del inventario (add-minimal-inventory, design D2, D3, D5 y D8): stock contabilizado por
// hechos fiscales autorizados, nunca una reserva. Cada movimiento lleva su variación con signo y el
// saldo es la suma exacta de esas variaciones. Nada pasa por `number`: las cantidades son texto
// decimal y se operan con las primitivas exactas de `platform/decimal`.
import {
  canonicalDecimal,
  compareDecimalStrings,
  type StockMovementType,
  type StockTrackingState,
} from "@facturador/contracts";
import { sumExact } from "../../../platform/decimal/fiscal-decimal.ts";

/** Regla del signo de cada tipo (design D2), la misma que el `CHECK` de la base. */
const SIGN_RULES: Readonly<
  Record<StockMovementType, Readonly<{ accepts: (sign: number) => boolean; message: string }>>
> = {
  INICIAL: { accepts: (sign) => sign >= 0, message: "El saldo inicial no puede ser negativo." },
  ENTRADA_MANUAL: { accepts: (sign) => sign > 0, message: "Una entrada debe ser positiva." },
  SALIDA_FACTURA: { accepts: (sign) => sign < 0, message: "Una salida debe ser negativa." },
  DEVOLUCION_NC: { accepts: (sign) => sign > 0, message: "Una devolución debe ser positiva." },
  AJUSTE: { accepts: (sign) => sign !== 0, message: "Un ajuste no puede ser de cero." },
};

/** Mensaje si la variación no cumple el signo de su tipo; null si lo cumple. */
export function signViolation(type: StockMovementType, delta: string): string | null {
  const rule = SIGN_RULES[type];
  return rule.accepts(compareDecimalStrings(delta, "0")) ? null : rule.message;
}

/** Saldo menor que cero: se muestra tal cual, nunca se trunca (Q-19). */
export const isNegative = (balance: string): boolean => compareDecimalStrings(balance, "0") < 0;

/** Estado derivado de la marca del producto y de la existencia de su inventario (design D8). */
export function trackingState(stockTracked: boolean, initialized: boolean): StockTrackingState {
  if (initialized) return stockTracked ? "TRACKED_INITIALIZED" : "DISABLED_INITIALIZED";
  return stockTracked ? "TRACKED_NOT_INITIALIZED" : "NOT_TRACKED";
}

/** Ecuador continental: UTC-05:00 todo el año, sin horario de verano (America/Guayaquil). */
const ECUADOR_MIDNIGHT = "T00:00:00-05:00";
const DAY_MS = 86_400_000;

/** Instantes del kárdex por fechas de Ecuador inclusivas (design D8): desde y antes de. */
export type MovementRange = Readonly<{ from?: Date; before?: Date }>;

export function ecuadorRange(from?: string, to?: string): MovementRange {
  return {
    ...(from ? { from: new Date(`${from}${ECUADOR_MIDNIGHT}`) } : {}),
    ...(to ? { before: new Date(new Date(`${to}${ECUADOR_MIDNIGHT}`).getTime() + DAY_MS) } : {}),
  };
}

/** Línea de una factura con la decisión de inventario congelada al reservar (design D4). */
export type InvoiceStockLine = Readonly<{
  productId: string;
  quantity: string;
  inventoryAffectsStock: boolean;
}>;

export type Outflow = Readonly<{ productId: string; quantity: string }>;

/**
 * Salidas de una factura (design D5): solo las líneas que afectan al inventario, agrupadas por
 * producto con su suma exacta, sin los productos cuya suma es cero, y en orden estable de
 * `productId` para bloquear los saldos siempre en el mismo orden.
 */
export function outflowsOf(lines: readonly InvoiceStockLine[]): Outflow[] {
  const byProduct = new Map<string, string[]>();
  for (const line of lines) {
    if (!line.inventoryAffectsStock) continue;
    byProduct.set(line.productId, [...(byProduct.get(line.productId) ?? []), line.quantity]);
  }
  return [...byProduct.entries()]
    .map(([productId, quantities]) => ({
      productId,
      quantity: canonicalDecimal(sumExact(quantities)),
    }))
    .filter((outflow) => outflow.quantity !== "0")
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}

/** Variación de un movimiento a partir de la cantidad pedida: la salida resta. */
export const negate = (quantity: string): string =>
  quantity.startsWith("-")
    ? quantity.slice(1)
    : canonicalDecimal(quantity) === "0"
      ? "0"
      : `-${quantity}`;

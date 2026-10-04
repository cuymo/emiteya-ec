// Dominio del inventario (add-minimal-inventory, tarea 3.1, design D2, D5 y D8): signos por tipo,
// estado derivado, saldo negativo y agrupación exacta de las líneas por producto, sin `number`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isNegative,
  negate,
  outflowsOf,
  signViolation,
  trackingState,
} from "../../src/modules/inventory/domain/stock.ts";

describe("dominio del inventario", () => {
  it("cada tipo tiene su signo, como el CHECK de la base", () => {
    expect(signViolation("INICIAL", "0")).toBeNull();
    expect(signViolation("INICIAL", "-1")).toBe("El saldo inicial no puede ser negativo.");
    expect(signViolation("ENTRADA_MANUAL", "0")).toBe("Una entrada debe ser positiva.");
    expect(signViolation("ENTRADA_MANUAL", "0.000001")).toBeNull();
    expect(signViolation("SALIDA_FACTURA", "-3")).toBeNull();
    expect(signViolation("SALIDA_FACTURA", "3")).toBe("Una salida debe ser negativa.");
    expect(signViolation("DEVOLUCION_NC", "2")).toBeNull();
    expect(signViolation("AJUSTE", "0.0")).toBe("Un ajuste no puede ser de cero.");
    expect(signViolation("AJUSTE", "-4")).toBeNull();
  });

  it("el estado se deriva de la marca y de la existencia del inventario", () => {
    expect(trackingState(false, false)).toBe("NOT_TRACKED");
    expect(trackingState(true, false)).toBe("TRACKED_NOT_INITIALIZED");
    expect(trackingState(true, true)).toBe("TRACKED_INITIALIZED");
    expect(trackingState(false, true)).toBe("DISABLED_INITIALIZED");
  });

  it("el saldo negativo se reconoce sin convertirlo a número", () => {
    expect(isNegative("-0.000001")).toBe(true);
    expect(isNegative("0")).toBe(false);
    expect(isNegative("999999999999999999999999.999999")).toBe(false);
    expect(negate("3.75")).toBe("-3.75");
    expect(negate("-2")).toBe("2");
    expect(negate("0.00")).toBe("0");
  });

  it("agrupa las líneas que afectan al inventario por producto, con la suma exacta y en orden estable", () => {
    expect(
      outflowsOf([
        { productId: "p-b", quantity: "2", inventoryAffectsStock: true },
        { productId: "p-a", quantity: "1.5", inventoryAffectsStock: true },
        { productId: "p-c", quantity: "9", inventoryAffectsStock: false },
        { productId: "p-a", quantity: "2.25", inventoryAffectsStock: true },
        { productId: "p-z", quantity: "0", inventoryAffectsStock: true },
        { productId: "p-z", quantity: "0.000", inventoryAffectsStock: true },
      ]),
    ).toEqual([
      { productId: "p-a", quantity: "3.75" },
      { productId: "p-b", quantity: "2" },
    ]);
    expect(
      outflowsOf([
        { productId: "p-a", quantity: "999999999999.999999", inventoryAffectsStock: true },
        { productId: "p-a", quantity: "999999999999.999999", inventoryAffectsStock: true },
      ]),
    ).toEqual([{ productId: "p-a", quantity: "1999999999999.999998" }]);
  });

  it("el dominio no convierte cantidades a number ni usa decimal.js", () => {
    const source = readFileSync(
      new URL("../../src/modules/inventory/domain/stock.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\bNumber\(|parseFloat|parseInt|decimal\.js/);
  });
});

// Política decimal del backend (add-fiscal-catalogs, design D10): exacta, sin `number` y sin
// redondear al recibir.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DecimalValueError,
  FiscalDecimal,
  Money,
  Percentage,
  Quantity,
  UnitPrice,
  roundHalfUp,
} from "../../src/platform/decimal/fiscal-decimal.ts";

describe("FiscalDecimal", () => {
  it("guarda y devuelve el valor exacto en forma canónica", () => {
    expect(UnitPrice.parse("12.345678").toString()).toBe("12.345678");
    expect(UnitPrice.parse("12.500000").toString()).toBe("12.5");
    expect(Percentage.parse("15.00").toString()).toBe("15");
    expect(Money.parse("50.00").toString()).toBe("50");
  });

  it("conserva todos los dígitos que un number perdería", () => {
    const price = UnitPrice.parse("123456789012.123456");
    expect(price.toString()).toBe("123456789012.123456");
    expect(String(Number("123456789012.123456"))).not.toBe("123456789012.123456");
  });

  it("convierte hacia y desde la base de datos por texto, en forma canónica", () => {
    expect(Percentage.parse("12.00").toDatabase()).toBe("12");
    expect(UnitPrice.parse("999999999999.999990").toDatabase()).toBe("999999999999.99999");
    expect(Money.fromDatabase({ toFixed: () => "50.00" }).toString()).toBe("50");
    expect(Quantity.fromDatabase("0.000001").toString()).toBe("0.000001");
  });

  it("rechaza escala de más, negativos y formatos ajenos sin redondear", () => {
    for (const [type, text] of [
      [UnitPrice, "1.0000001"],
      [Percentage, "-1"],
      [Percentage, "100.01"],
      [Money, "1e3"],
      [Money, "1,5"],
      [Quantity, " 1"],
    ] as const) {
      expect(() => type.parse(text), text).toThrow(DecimalValueError);
    }
  });

  it("los tipos siguen la regla del XSD: total y decimales, sin el límite de NUMERIC(p, s)", () => {
    for (const text of ["0", "0.000001", "999999999999999999", "999999999999.999999"]) {
      expect(UnitPrice.parse(text).toString()).toBe(text);
    }
    for (const text of ["1000000000000000000", "1234567890123.123456", "0.0000001", "-1"]) {
      expect(() => UnitPrice.parse(text), text).toThrow(DecimalValueError);
    }
    expect(Percentage.parse("300").toString()).toBe("300");
    expect(Money.parse("99999999999999").toString()).toBe("99999999999999");
    expect(Quantity.parse("999999999999999999").toString()).toBe("999999999999999999");
    expect(() => Percentage.parse("100.55")).toThrow("Admite como máximo 4 dígitos en total.");
    expect(() => Money.parse("100000000000000")).toThrow("Admite como máximo 14 dígitos en total.");
  });

  it("compara y detecta igualdad exacta", () => {
    expect(Money.parse("50").equals(Money.parse("50.00"))).toBe(true);
    expect(UnitPrice.parse("0.1").compare(UnitPrice.parse("0.099999"))).toBe(1);
    expect(FiscalDecimal.parse("tarifa", "5").compare(FiscalDecimal.parse("tarifa", "13"))).toBe(
      -1,
    );
  });

  it("redondeo half-up para la emisión (Q-14), a escala fija", () => {
    expect(roundHalfUp("2.345", 2)).toBe("2.35");
    expect(roundHalfUp("2.344", 2)).toBe("2.34");
    expect(roundHalfUp("-2.345", 2)).toBe("-2.35");
    expect(roundHalfUp("1.005", 2)).toBe("1.01");
  });

  it("el módulo no convierte importes a number", () => {
    const source = readFileSync(
      new URL("../../src/platform/decimal/fiscal-decimal.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\b(Number|parseFloat|parseInt)\(|\.toNumber\(|valueOf\(/);
  });
});

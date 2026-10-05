// Presentación de decimales sin pasar por number (add-fiscal-catalogs, design D10).
import { describe, expect, it } from "vitest";
import { formatDelta } from "@/features/inventory/inventory-format";
import { formatDecimal, formatPercentage, formatUsd } from "@/lib/decimal";

describe("formatDecimal", () => {
  it("usa los separadores de es-EC y conserva todos los dígitos", () => {
    expect(formatDecimal("1234567.123456")).toBe("1.234.567,123456");
    expect(formatDecimal("123456789012.123456")).toBe("123.456.789.012,123456");
    expect(formatDecimal("12.50")).toBe("12,5");
    expect(formatDecimal("-2500")).toBe("-2.500");
  });

  it("completa decimales cuando se pide y deja intacto un texto que no es decimal", () => {
    expect(formatDecimal("50", { minFractionDigits: 2 })).toBe("50,00");
    expect(formatDecimal("1e3")).toBe("1e3");
  });

  it("porcentajes e importes en dólares", () => {
    expect(formatPercentage("15")).toBe("15 %");
    expect(formatPercentage("12.5")).toBe("12,5 %");
    expect(formatUsd("50")).toBe("USD 50,00");
  });
});

describe("formatDelta (add-minimal-inventory)", () => {
  it("muestra el signo de la variación, y un saldo inicial de cero sin signo", () => {
    expect(formatDelta("5")).toBe("+5");
    expect(formatDelta("-3.5")).toBe("-3,5");
    expect(formatDelta("1250.000001")).toBe("+1.250,000001");
    expect(formatDelta("0")).toBe("0");
  });
});

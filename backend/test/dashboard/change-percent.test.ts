// Variación de las ventas del tablero (redesign-dashboard-indicators, design D1): la calcula el
// servidor, con un decimal redondeado a la mitad hacia arriba y con signo.
import { describe, expect, it } from "vitest";
import { changePercent } from "../../src/modules/dashboard/application/dashboard.ts";

describe("variación de las ventas", () => {
  it("sube, baja o no cambia, con un decimal y signo", () => {
    expect(changePercent("1095.00", "1000.00")).toBe("9.5");
    expect(changePercent("800", "1000")).toBe("-20.0");
    expect(changePercent("1000", "1000")).toBe("0.0");
    expect(changePercent("0", "250.50")).toBe("-100.0");
  });

  it("redondea a la mitad hacia arriba, también al bajar", () => {
    // 1/3 de subida: 33,333… → 33,3; 2/3: 66,666… → 66,7.
    expect(changePercent("4", "3")).toBe("33.3");
    expect(changePercent("5", "3")).toBe("66.7");
    expect(changePercent("2", "3")).toBe("-33.3");
    // Una bajada que redondea a cero no lleva signo.
    expect(changePercent("99999.99", "100000")).toBe("0.0");
  });

  it("sin ventas el mes anterior no hay variación", () => {
    expect(changePercent("150.00", "0")).toBeNull();
    expect(changePercent("0", "0.00")).toBeNull();
  });
});

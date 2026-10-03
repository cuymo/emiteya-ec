// Datos de cálculo por tipo de tarifa (add-parties-and-products, design D2).
import { describe, expect, it } from "vitest";
import { calculationDataStatus } from "../../src/modules/catalogs/domain/calculation-data.ts";

describe("calculationDataStatus", () => {
  it("una tarifa porcentual con porcentaje, no objeto y exenta tienen datos completos", () => {
    expect(calculationDataStatus({ rateKind: "PERCENTAGE", percentage: "15" })).toBe("COMPLETE");
    expect(calculationDataStatus({ rateKind: "PERCENTAGE", percentage: "0" })).toBe("COMPLETE");
    expect(calculationDataStatus({ rateKind: "NOT_SUBJECT", percentage: null })).toBe("COMPLETE");
    expect(calculationDataStatus({ rateKind: "EXEMPT", percentage: null })).toBe("COMPLETE");
  });

  it("el IVA diferenciado, el ICE y el IRBPNR no tienen valores transcritos", () => {
    for (const rateKind of ["DIFFERENTIATED", "PER_NORMATIVE", "PER_UNIT"] as const) {
      expect(calculationDataStatus({ rateKind, percentage: null }), rateKind).toBe("MISSING");
    }
    expect(calculationDataStatus({ rateKind: "PERCENTAGE", percentage: null })).toBe("MISSING");
    expect(calculationDataStatus({ rateKind: null, percentage: null })).toBe("MISSING");
  });
});

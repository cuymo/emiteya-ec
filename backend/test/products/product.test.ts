// Reglas puras del producto (add-parties-and-products, design D6 a D9): estado tributario derivado
// con su precedencia, invariantes del tipo sobre el estado final y precio exacto.
import { describe, expect, it } from "vitest";
import {
  canonicalPrice,
  goodsOnlyViolations,
  productChanges,
  taxReferences,
  type ProductRecord,
} from "../../src/modules/products/domain/product.ts";
import {
  referenceReason,
  taxConfiguration,
  type ReferenceAvailability,
} from "../../src/modules/products/domain/tax-configuration.ts";

const ready: ReferenceAvailability = {
  code: "4",
  applicable: true,
  withdrawn: false,
  usable: true,
  calculationData: "COMPLETE",
};

describe("referenceReason", () => {
  it("cada motivo según la disponibilidad", () => {
    expect(referenceReason(ready)).toBeNull();
    expect(referenceReason({ ...ready, applicable: false, usable: false })).toBe("NOT_IN_FORCE");
    expect(referenceReason(undefined)).toBe("NOT_IN_FORCE");
    expect(referenceReason({ ...ready, applicable: false, withdrawn: true, usable: false })).toBe(
      "WITHDRAWN",
    );
    expect(referenceReason({ ...ready, usable: false })).toBe("DISABLED");
    expect(referenceReason({ ...ready, calculationData: "MISSING" })).toBe("NO_CALCULATION_DATA");
  });
});

describe("taxConfiguration", () => {
  const references = taxReferences({ iva: "4", ice: "3011", irbpnr: "5001" });
  const config = (byKey: Record<string, ReferenceAvailability>) =>
    taxConfiguration(references, (ref) => byKey[ref.entryKey]);

  it("READY con IVA porcentual y sin ICE ni IRBPNR", () => {
    expect(
      taxConfiguration(taxReferences({ iva: "4", ice: null, irbpnr: null }), () => ready),
    ).toEqual({
      status: "READY",
      reasons: [],
    });
  });

  it("ICE, IRBPNR e IVA diferenciado sin datos de cálculo dejan el producto INCOMPLETE", () => {
    const missing = { ...ready, calculationData: "MISSING" as const };
    const result = config({
      "4": ready,
      "3011": { ...missing, code: "3011" },
      "5001": { ...missing, code: "5001" },
    });
    expect(result.status).toBe("INCOMPLETE");
    expect(result.reasons.map((r) => [r.slot, r.reason])).toEqual([
      ["ice", "NO_CALCULATION_DATA"],
      ["irbpnr", "NO_CALCULATION_DATA"],
    ]);
    expect(
      taxConfiguration(taxReferences({ iva: "8", ice: null, irbpnr: null }), () => missing).status,
    ).toBe("INCOMPLETE");
  });

  it("REVIEW_REQUIRED prevalece sobre INCOMPLETE e indica cada referencia afectada", () => {
    const result = config({
      "4": { ...ready, usable: false },
      "3011": { ...ready, code: "3011", calculationData: "MISSING" },
      "5001": { ...ready, code: "5001", applicable: false, withdrawn: true, usable: false },
    });
    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.reasons.map((r) => [r.slot, r.code, r.reason])).toEqual([
      ["iva", "4", "DISABLED"],
      ["ice", "3011", "NO_CALCULATION_DATA"],
      ["irbpnr", "5001", "WITHDRAWN"],
    ]);
  });
});

describe("invariantes del tipo sobre el estado final", () => {
  const good = {
    kind: "GOOD" as const,
    stockTracked: true,
    taxes: { iva: "4", ice: null, irbpnr: "5001" },
  };

  it("un bien admite IRBPNR y control de stock", () => {
    expect(goodsOnlyViolations(good)).toEqual([]);
  });

  it("de bien a servicio conservando el IRBPNR o el control de stock se rechaza", () => {
    expect(goodsOnlyViolations({ ...good, kind: "SERVICE", stockTracked: false })).toEqual([
      "irbpnr",
    ]);
    expect(
      goodsOnlyViolations({ ...good, kind: "SERVICE", taxes: { ...good.taxes, irbpnr: null } }),
    ).toEqual(["stockTracked"]);
    expect(goodsOnlyViolations({ ...good, kind: "SERVICE" })).toEqual(["irbpnr", "stockTracked"]);
  });

  it("de bien a servicio quitando ambos en la misma solicitud es válido", () => {
    expect(
      goodsOnlyViolations({
        kind: "SERVICE",
        stockTracked: false,
        taxes: { ...good.taxes, irbpnr: null },
      }),
    ).toEqual([]);
  });
});

describe("precio exacto", () => {
  it("la forma canónica más corta, sin pasar por number", () => {
    expect(canonicalPrice("12.50")).toBe("12.5");
    expect(canonicalPrice("999999999999.999999")).toBe("999999999999.999999");
    expect(canonicalPrice("0.000001")).toBe("0.000001");
    // 0.1 + 0.2 en coma flotante no es 0.3; el texto decimal se conserva exacto.
    expect(canonicalPrice("0.300000")).toBe("0.3");
  });

  it("solo el precio y los impuestos son cambios auditables", () => {
    const before: ProductRecord = {
      id: "p",
      companyId: "c",
      kind: "GOOD",
      mainCode: "A",
      auxiliaryCode: null,
      name: "Uno",
      description: null,
      unitPrice: "8.75",
      stockTracked: false,
      status: "ACTIVE",
      version: 1,
      taxes: { iva: "4", ice: null, irbpnr: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const data = { ...before, unitPrice: "8.750", name: "Otro nombre" };
    expect(productChanges(before, data)).toBeNull();
    expect(
      productChanges(before, {
        ...data,
        unitPrice: "9.10",
        taxes: { iva: "2", ice: null, irbpnr: null },
      }),
    ).toEqual({
      "unitPrice.from": "8.75",
      "unitPrice.to": "9.1",
      "taxes.iva.from": "4",
      "taxes.iva.to": "2",
    });
  });
});

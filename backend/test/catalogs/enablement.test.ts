// Semántica única de la habilitación por empresa (add-fiscal-catalogs, design D9).
import { describe, expect, it } from "vitest";
import { effectiveEnablement, isUsable } from "../../src/modules/catalogs/domain/enablement.ts";

describe("effectiveEnablement", () => {
  it("sin decisión rige la política del catálogo", () => {
    expect(effectiveEnablement({ decision: undefined, policy: "DEFAULT_ENABLED" })).toEqual({
      enabled: true,
      source: "DEFAULT",
    });
    expect(effectiveEnablement({ decision: undefined, policy: "DEFAULT_DISABLED" })).toEqual({
      enabled: false,
      source: "DEFAULT",
    });
  });

  it("una decisión de la empresa prevalece, también si coincide con el valor por defecto", () => {
    expect(effectiveEnablement({ decision: false, policy: "DEFAULT_ENABLED" })).toEqual({
      enabled: false,
      source: "COMPANY",
    });
    expect(effectiveEnablement({ decision: true, policy: "DEFAULT_ENABLED" })).toEqual({
      enabled: true,
      source: "COMPANY",
    });
  });

  it("un catálogo no habilitable está siempre disponible e ignora cualquier decisión", () => {
    expect(effectiveEnablement({ decision: false, policy: "NOT_ENABLEABLE" })).toEqual({
      enabled: true,
      source: "NOT_ENABLEABLE",
    });
  });
});

describe("isUsable", () => {
  const enabled = { enabled: true, source: "COMPANY" } as const;
  it("exige una versión aplicable y la habilitación", () => {
    expect(isUsable({ id: "v1" }, enabled)).toBe(true);
    expect(isUsable(null, enabled)).toBe(false);
    expect(isUsable({ id: "v1" }, { enabled: false, source: "DEFAULT" })).toBe(false);
  });
});

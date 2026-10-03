// Contrato del adaptador AccessKeys (add-invoice-emission, tarea 6.1, design D12): 49 dígitos con
// la estructura de CTX §8.1 y el dígito verificador de la implementación de referencia de CTX §8.3,
// calculado aquí de forma independiente. Debe pasar antes de aceptar cualquier actualización de
// facturacion-electronica-ec. El vector oficial de la ficha v2.34 está pendiente (tarea 12.2).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccessKeyInputError,
  type AccessKeyInput,
} from "../../src/modules/sri-engine/application/ports.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";

/** CTX §8.3, transcrita: pesos 2 a 7 desde la derecha; 11 → 0 y 10 → 1. */
function sriModulo11(first48Digits: string): number {
  if (!/^\d{48}$/.test(first48Digits)) {
    throw new Error("La base de la clave debe tener exactamente 48 dígitos");
  }
  let factor = 2;
  let sum = 0;
  for (let i = first48Digits.length - 1; i >= 0; i--) {
    sum += Number(first48Digits[i]) * factor;
    factor++;
    if (factor > 7) factor = 2;
  }
  const result = 11 - (sum % 11);
  if (result === 11) return 0;
  if (result === 10) return 1;
  return result;
}

const keys = createAccessKeys();
const base: AccessKeyInput = {
  issueDate: "2026-10-03",
  documentType: "01",
  ruc: "1790012345001",
  environment: "1",
  establishment: "001",
  emissionPoint: "002",
  sequential: "000000001",
  numericCode: "12345678",
};
const compose = (overrides: Partial<AccessKeyInput> = {}) =>
  keys.compose({ ...base, ...overrides });

describe("contrato de AccessKeys (CTX §8)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("compone la estructura de CTX §8.1 con el dígito verificador de §8.3", () => {
    for (const sequential of ["000000001", "000000009", "000000010", "999999999"]) {
      const key = compose({ sequential });
      expect(key).toMatch(/^\d{49}$/);
      expect(key.slice(0, 48), sequential).toBe(
        `03102026011790012345001${"1"}001002${sequential}12345678${"1"}`,
      );
      expect(Number(key[48]), sequential).toBe(sriModulo11(key.slice(0, 48)));
    }
  });

  it("la fecha, el tipo y el ambiente ocupan sus posiciones", () => {
    const key = compose({ issueDate: "2027-01-31", documentType: "07", environment: "2" });
    expect(key.slice(0, 8)).toBe("31012027");
    expect(key.slice(8, 10)).toBe("07");
    expect(key[23]).toBe("2");
    expect(key[47]).toBe("1");
  });

  it("500 códigos numéricos aleatorios dan siempre el dígito de la referencia", () => {
    for (let i = 0; i < 500; i++) {
      const key = compose({ numericCode: keys.numericCode() });
      expect(Number(key[48])).toBe(sriModulo11(key.slice(0, 48)));
    }
  });

  it("cubre los dígitos verificadores 0 y 1 de los casos 11 y 10", () => {
    const seen = new Set<string>();
    for (let code = 0; code < 200 && seen.size < 11; code++) {
      const key = compose({ numericCode: String(code).padStart(8, "0") });
      expect(Number(key[48])).toBe(sriModulo11(key.slice(0, 48)));
      seen.add(key[48]!);
    }
    expect(seen).toContain("0");
    expect(seen).toContain("1");
  });

  it("cambiar un solo dígito de los datos cambia la clave y su verificador sigue la referencia", () => {
    const original = compose();
    const changed = compose({ sequential: "000000002" });
    expect(changed).not.toBe(original);
    expect(Number(changed[48])).toBe(sriModulo11(changed.slice(0, 48)));
  });

  it("rechaza longitudes y caracteres inválidos sin repetir los datos", () => {
    for (const overrides of [
      { sequential: "1" },
      { sequential: "0000000001" },
      { sequential: "00000000A" },
      { numericCode: "1234567" },
      { numericCode: "1234567X" },
      { ruc: "179001234500" },
      { establishment: "1" },
      { emissionPoint: "0021" },
      { issueDate: "03/10/2026" },
      { environment: "3" as "1" },
    ] as Partial<AccessKeyInput>[]) {
      let error: unknown;
      try {
        compose(overrides);
      } catch (caught) {
        error = caught;
      }
      expect(error, JSON.stringify(overrides)).toBeInstanceOf(AccessKeyInputError);
      expect((error as Error).message).toBe("ACCESS_KEY_INVALID_INPUT");
      for (const value of Object.values(overrides)) {
        expect((error as Error).message).not.toContain(String(value));
      }
    }
  });

  it("el código numérico tiene 8 dígitos de crypto.randomInt, sin Math.random", () => {
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random no debe usarse");
    });
    const codes = Array.from({ length: 500 }, () => keys.numericCode());
    for (const code of codes) expect(code).toMatch(/^\d{8}$/);
    expect(new Set(codes).size).toBeGreaterThan(490);
    const source = readFileSync(
      new URL("../../src/modules/sri-engine/infrastructure/access-keys.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/Math\.random\(|generateCodigoNumerico\(/);
    expect(source).toMatch(/randomInt\(0, 100_000_000\)/);
  });
});

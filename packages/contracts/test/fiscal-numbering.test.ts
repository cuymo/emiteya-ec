import { describe, expect, it } from "vitest";
import {
  adjustSequenceSchema,
  documentNumber,
  fiscalSequenceViewSchema,
  formatSequential,
  sequenceParamsSchema,
  sequencesQuerySchema,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe("formato del secuencial (ERS RF-124)", () => {
  it("representa el secuencial con nueve dígitos y el número completo", () => {
    expect(formatSequential(1)).toBe("000000001");
    expect(formatSequential(999_999_999)).toBe("999999999");
    expect(documentNumber("001", "002", 1)).toBe("001-002-000000001");
  });

  it("rechaza valores fuera de nueve dígitos, incluido el valor interno de agotado", () => {
    for (const value of [0, -1, 1.5, 1_000_000_000]) {
      expect(() => formatSequential(value), String(value)).toThrow(RangeError);
    }
  });
});

describe("ajuste del siguiente secuencial (design D9)", () => {
  const parse = (input: Record<string, unknown>) => adjustSequenceSchema.safeParse(input);
  const invalidNext = "El siguiente secuencial debe ser un número entero entre 1 y 999999999.";

  it("acepta avanzar sin motivo y deja el motivo vacío en null", () => {
    expect(parse({ nextNumber: 100, expectedNextNumber: 10 }).data).toEqual({
      nextNumber: 100,
      expectedNextNumber: 10,
      reason: null,
    });
    expect(
      parse({ nextNumber: 100, expectedNextNumber: 10, reason: "  " }).data?.reason,
    ).toBeNull();
  });

  it("exige un motivo para retroceder y lo acepta con él", () => {
    expect(messages(parse({ nextNumber: 5, expectedNextNumber: 10 }))).toContain(
      "Retroceder el secuencial exige un motivo.",
    );
    expect(
      parse({ nextNumber: 5, expectedNextNumber: 10, reason: "Se avanzó por error" }).success,
    ).toBe(true);
  });

  it("rechaza 0, 1000000000 y decimales, también como valor esperado", () => {
    for (const value of [0, 1_000_000_000, 12.5]) {
      expect(messages(parse({ nextNumber: value, expectedNextNumber: 1 }))).toContain(invalidNext);
      expect(messages(parse({ nextNumber: 2, expectedNextNumber: value }))).toContain(
        "El secuencial esperado no es válido.",
      );
    }
  });

  it("limita el motivo a 300 caracteres de una línea", () => {
    expect(
      messages(parse({ nextNumber: 5, expectedNextNumber: 10, reason: "a".repeat(301) })),
    ).toContain("El motivo debe tener como máximo 300 caracteres.");
    expect(messages(parse({ nextNumber: 5, expectedNextNumber: 10, reason: "a\nb" }))).toContain(
      "El motivo no puede tener saltos de línea.",
    );
  });

  it("rechaza companyId y campos desconocidos", () => {
    expect(messages(parse({ nextNumber: 2, expectedNextNumber: 1, companyId: "otra" }))).toContain(
      "La solicitud contiene campos no permitidos.",
    );
  });
});

describe("parámetros, consulta y vista", () => {
  it("validan el ambiente y el tipo de comprobante", () => {
    const params = { establishmentId: "e", emissionPointId: "p", environment: "TEST" };
    expect(sequenceParamsSchema.safeParse({ ...params, documentType: "01" }).success).toBe(true);
    expect(messages(sequenceParamsSchema.safeParse({ ...params, documentType: "02" }))).toContain(
      "El tipo de comprobante no es válido.",
    );
    expect(sequencesQuerySchema.safeParse({ environment: "STAGING" }).success).toBe(false);
    expect(
      sequencesQuerySchema.safeParse({ environment: "PRODUCTION", companyId: "x" }).success,
    ).toBe(true);
  });

  it("la vista no admite el valor interno de agotado como siguiente secuencial", () => {
    const view = {
      establishment: { id: "e", code: "001", status: "ACTIVE" },
      emissionPoint: { id: "p", code: "001", status: "ACTIVE", available: true },
      environment: "TEST",
      documentType: "01",
      nextNumber: null,
      lastReserved: 999_999_999,
      exhausted: true,
    };
    expect(fiscalSequenceViewSchema.safeParse(view).success).toBe(true);
    expect(fiscalSequenceViewSchema.safeParse({ ...view, nextNumber: 1_000_000_000 }).success).toBe(
      false,
    );
  });
});

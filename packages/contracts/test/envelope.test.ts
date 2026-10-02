import { z } from "zod";
import { describe, expect, it } from "vitest";
import { errorEnvelopeSchema, successEnvelope } from "@facturador/contracts";

describe("sobre de éxito", () => {
  const schema = successEnvelope(z.object({ id: z.string() }));

  it("acepta data con meta opcional", () => {
    expect(schema.safeParse({ data: { id: "1" } }).success).toBe(true);
    expect(schema.safeParse({ data: { id: "1" }, meta: { page: 1 } }).success).toBe(true);
  });

  it("rechaza un sobre sin data, con data inválida o con campos desconocidos", () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ data: { id: 1 } }).success).toBe(false);
    expect(schema.safeParse({ data: { id: "1" }, extra: true }).success).toBe(false);
  });
});

describe("sobre de error", () => {
  it("acepta code, message y requestId", () => {
    const valid = {
      error: { code: "NOT_FOUND", message: "Recurso no encontrado", requestId: "r-1" },
    };
    expect(errorEnvelopeSchema.safeParse(valid).success).toBe(true);
  });

  it("rechaza un error sin requestId, con campos vacíos o con detalle extra", () => {
    expect(errorEnvelopeSchema.safeParse({ error: { code: "X", message: "Y" } }).success).toBe(
      false,
    );
    expect(
      errorEnvelopeSchema.safeParse({ error: { code: "", message: "Y", requestId: "r" } }).success,
    ).toBe(false);
    expect(
      errorEnvelopeSchema.safeParse({
        error: { code: "X", message: "Y", requestId: "r", stack: "..." },
      }).success,
    ).toBe(false);
  });
});

// Cabecera y huella de la idempotencia (add-invoice-emission, tarea 8.1, design D8).
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  readIdempotencyKey,
  requestFingerprint,
} from "../../src/platform/idempotency/idempotency.ts";

const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
};

describe("cabecera Idempotency-Key", () => {
  it("acepta de 1 a 100 caracteres ASCII visibles", () => {
    for (const key of ["a", "x".repeat(100), "f47ac10b-58cc-4372-a567-0e02b2c3d479", "!~"]) {
      expect(readIdempotencyKey(key)).toBe(key);
    }
  });

  it("sin cabecera, vacía, repetida o con otro formato es 400 IDEMPOTENCY_KEY_REQUIRED", () => {
    for (const value of [undefined, "", [], ["a", "b"], "x".repeat(101), "con espacio", "ñ"]) {
      expect(
        codeOf(() => readIdempotencyKey(value)),
        JSON.stringify(value),
      ).toBe("IDEMPOTENCY_KEY_REQUIRED");
    }
  });
});

describe("huella canónica de la solicitud", () => {
  it("no depende del orden de las claves ni de los campos ausentes", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null }, e: undefined })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
    expect(requestFingerprint("invoice.emit", { draftId: "d", expectedVersion: 2 })).toBe(
      requestFingerprint("invoice.emit", { expectedVersion: 2, draftId: "d" }),
    );
  });

  it("cambia con el borrador, con su versión y con la operación", () => {
    const base = requestFingerprint("invoice.emit", { draftId: "d", expectedVersion: 2 });
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(requestFingerprint("invoice.emit", { draftId: "e", expectedVersion: 2 })).not.toBe(base);
    expect(requestFingerprint("invoice.emit", { draftId: "d", expectedVersion: 3 })).not.toBe(base);
    // La operación forma parte de la huella: la solicitud no puede sustituirla.
    expect(
      requestFingerprint("invoice.emit", { draftId: "d", expectedVersion: 2, operation: "x" }),
    ).toBe(base);
  });
});

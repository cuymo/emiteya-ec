import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TYPES,
  EXHAUSTED_NEXT_NUMBER,
  INITIAL_COUNTER,
  classifyAdjustment,
  isExhausted,
  visibleNextNumber,
} from "../../src/modules/fiscal/domain/numbering.ts";

describe("numeración fiscal (design D2, D6 y D9)", () => {
  it("conoce los seis códigos de comprobante en su orden", () => {
    expect(DOCUMENT_TYPES).toEqual(["01", "03", "04", "05", "06", "07"]);
  });

  it("un contador nuevo empieza en 1 sin reservados", () => {
    expect(INITIAL_COUNTER).toEqual({ nextNumber: 1, lastReserved: null });
    expect(visibleNextNumber(INITIAL_COUNTER)).toBe(1);
  });

  it("el valor de agotado nunca se ve como siguiente secuencial", () => {
    const exhausted = { nextNumber: EXHAUSTED_NEXT_NUMBER, lastReserved: 999_999_999 };
    expect(EXHAUSTED_NEXT_NUMBER).toBe(1_000_000_000);
    expect(isExhausted(exhausted)).toBe(true);
    expect(visibleNextNumber(exhausted)).toBeNull();
    expect(isExhausted({ nextNumber: 999_999_999, lastReserved: 999_999_998 })).toBe(false);
  });

  it("clasifica avance, retroceso y sin cambio", () => {
    const counter = { nextNumber: 100, lastReserved: 50 };
    expect(classifyAdjustment(counter, 100)).toEqual({ kind: "UNCHANGED" });
    expect(classifyAdjustment(counter, 500)).toEqual({ kind: "ADVANCE" });
    expect(classifyAdjustment(counter, 51)).toEqual({ kind: "DECREASE" });
    expect(classifyAdjustment(INITIAL_COUNTER, 1501)).toEqual({ kind: "ADVANCE" });
  });

  it("rechaza un valor igual o menor que el último reservado", () => {
    const counter = { nextNumber: 100, lastReserved: 50 };
    for (const desired of [50, 49, 1]) {
      expect(classifyAdjustment(counter, desired)).toEqual({
        kind: "REJECTED",
        reason: "RESERVED",
      });
    }
  });

  it("un contador agotado no admite ningún ajuste", () => {
    const exhausted = { nextNumber: EXHAUSTED_NEXT_NUMBER, lastReserved: 999_999_999 };
    for (const desired of [1, 999_999_999]) {
      expect(classifyAdjustment(exhausted, desired)).toEqual({
        kind: "REJECTED",
        reason: "EXHAUSTED",
      });
    }
  });
});

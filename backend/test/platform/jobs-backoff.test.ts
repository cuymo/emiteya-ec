// Backoff exponencial con jitter completo de la cola durable (design D5).
import { describe, expect, it } from "vitest";
import { backoffDelayMs } from "../../src/platform/jobs/jobs.ts";

const policy = { baseMs: 1_000, capMs: 60_000, minMs: 500 };

describe("backoff de la cola de jobs", () => {
  it("el techo crece al doble por intento hasta el tope", () => {
    const highest = (attempt: number) => backoffDelayMs(attempt, policy, () => 0.999_999);
    expect([1, 2, 3, 4].map(highest)).toEqual([999, 1_999, 3_999, 7_999]);
    expect(highest(7)).toBe(59_999);
    expect(highest(30)).toBe(59_999);
    expect(highest(5_000)).toBe(59_999);
  });

  it("nunca baja del mínimo ni supera el tope, con cualquier jitter", () => {
    for (let attempt = 1; attempt <= 40; attempt++) {
      for (const draw of [0, 0.1, 0.5, 0.9, 0.999_999]) {
        const delay = backoffDelayMs(attempt, policy, () => draw);
        expect(delay).toBeGreaterThanOrEqual(policy.minMs);
        expect(delay).toBeLessThanOrEqual(policy.capMs);
      }
    }
    expect(backoffDelayMs(1, policy, () => 0)).toBe(500);
  });

  it("el jitter es completo: reparte entre el mínimo y el techo", () => {
    const delays = Array.from({ length: 2_000 }, () => backoffDelayMs(6, policy));
    expect(Math.min(...delays)).toBeLessThan(5_000);
    expect(Math.max(...delays)).toBeGreaterThan(27_000);
    expect(Math.max(...delays)).toBeLessThan(32_000);
  });
});

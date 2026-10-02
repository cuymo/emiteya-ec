import { describe, expect, it } from "vitest";
import { LoginThrottle } from "../../src/modules/identity/infrastructure/better-auth/login-throttle.ts";

function throttle(max = 3, windowMs = 1_000) {
  let now = 0;
  const instance = new LoginThrottle({ max, windowMs }, () => now);
  return { instance, advance: (ms: number) => void (now += ms) };
}

describe("límite de fallos por correo e IP", () => {
  it("bloquea al alcanzar el número de fallos dentro de la ventana", () => {
    const { instance } = throttle();
    instance.recordFailure("a|1");
    instance.recordFailure("a|1");
    expect(instance.isBlocked("a|1")).toBe(false);
    instance.recordFailure("a|1");
    expect(instance.isBlocked("a|1")).toBe(true);
  });

  it("cada combinación de correo e IP lleva su propio contador", () => {
    const { instance } = throttle(1);
    instance.recordFailure("a|1");
    expect(instance.isBlocked("a|1")).toBe(true);
    expect(instance.isBlocked("b|1")).toBe(false);
    expect(instance.isBlocked("a|2")).toBe(false);
  });

  it("un inicio correcto reinicia el contador", () => {
    const { instance } = throttle(2);
    instance.recordFailure("a|1");
    instance.reset("a|1");
    instance.recordFailure("a|1");
    expect(instance.isBlocked("a|1")).toBe(false);
  });

  it("el bloqueo termina con la ventana", () => {
    const { instance, advance } = throttle(1, 1_000);
    instance.recordFailure("a|1");
    advance(999);
    expect(instance.isBlocked("a|1")).toBe(true);
    advance(1);
    expect(instance.isBlocked("a|1")).toBe(false);
    expect(instance.size).toBe(0);
  });

  it("acota la memoria ante muchos correos distintos, en tiempo lineal", () => {
    const { instance } = throttle(5, 60_000);
    const started = performance.now();
    for (let i = 0; i < 200_000; i++) instance.recordFailure(`correo${i}|1`);
    expect(instance.size).toBeLessThanOrEqual(50_000);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

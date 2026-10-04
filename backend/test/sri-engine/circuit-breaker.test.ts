// Circuit breaker por servicio y ambiente (add-sri-transmission, tarea 5.3, design D6).
import { describe, expect, it } from "vitest";
import type { TransportOutcome } from "../../src/modules/sri-engine/application/transport.ts";
import { createCircuitBreaker } from "../../src/modules/sri-engine/infrastructure/circuit-breaker.ts";

const at = new Date(0);
const failure: TransportOutcome = {
  kind: "NOT_SENT",
  errorCode: "ECONNREFUSED",
  startedAt: at,
  headersAt: null,
  completedAt: at,
};
const response = (httpStatus: number): TransportOutcome => ({
  kind: "RESPONSE",
  httpStatus,
  headers: {},
  body: Buffer.alloc(0),
  truncated: false,
  startedAt: at,
  headersAt: at,
  completedAt: at,
});

function breaker() {
  let clock = 1_000;
  const created = createCircuitBreaker({ failures: 3, cooldownMs: 60_000, now: () => clock });
  return { breaker: created, advance: (ms: number) => (clock += ms), now: () => clock };
}

describe("circuit breaker", () => {
  it("se abre tras N fallos seguidos; una respuesta reinicia la cuenta", () => {
    const { breaker: b } = breaker();
    b.record("TEST", "RECEPTION", failure);
    b.record("TEST", "RECEPTION", failure);
    b.record("TEST", "RECEPTION", response(200));
    b.record("TEST", "RECEPTION", failure);
    b.record("TEST", "RECEPTION", failure);
    expect(b.state("TEST", "RECEPTION")).toBe("CLOSED");
    b.record("TEST", "RECEPTION", response(503));
    expect(b.state("TEST", "RECEPTION")).toBe("OPEN");
  });

  it("abierto no deja llamar y dice cuándo volver; tras la pausa deja pasar una sola prueba", () => {
    const { breaker: b, advance } = breaker();
    for (let i = 0; i < 3; i++) b.record("TEST", "AUTHORIZATION", failure);
    expect(b.check("TEST", "AUTHORIZATION")).toEqual({
      allowed: false,
      retryAt: new Date(61_000),
    });
    advance(60_000);
    expect(b.check("TEST", "AUTHORIZATION")).toEqual({ allowed: true });
    expect(b.state("TEST", "AUTHORIZATION")).toBe("HALF_OPEN");
    expect(b.check("TEST", "AUTHORIZATION").allowed).toBe(false);
  });

  it("la prueba que responde lo cierra; la que falla lo vuelve a abrir", () => {
    const { breaker: b, advance } = breaker();
    for (let i = 0; i < 3; i++) b.record("TEST", "RECEPTION", failure);
    advance(60_000);
    b.check("TEST", "RECEPTION");
    b.record("TEST", "RECEPTION", failure);
    expect(b.state("TEST", "RECEPTION")).toBe("OPEN");
    advance(60_000);
    b.check("TEST", "RECEPTION");
    b.record("TEST", "RECEPTION", response(200));
    expect(b.state("TEST", "RECEPTION")).toBe("CLOSED");
    expect(b.check("TEST", "RECEPTION")).toEqual({ allowed: true });
  });

  it("cada servicio y ambiente tiene su propio circuito", () => {
    const { breaker: b } = breaker();
    for (let i = 0; i < 3; i++) b.record("TEST", "RECEPTION", failure);
    expect(b.state("TEST", "RECEPTION")).toBe("OPEN");
    expect(b.state("TEST", "AUTHORIZATION")).toBe("CLOSED");
    expect(b.state("PRODUCTION", "RECEPTION")).toBe("CLOSED");
  });
});

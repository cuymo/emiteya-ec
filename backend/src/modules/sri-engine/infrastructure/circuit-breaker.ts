// Circuit breaker por servicio y ambiente, en la memoria del proceso (add-sri-transmission, design
// D6). Se abre tras N fallos de transporte seguidos y se entreabre tras una pausa: deja pasar una
// sola llamada de prueba, que lo cierra si responde o lo vuelve a abrir si falla. Mientras está
// abierto no hay llamada, y el job se reprograma sin consumir intentos.
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import type { SriService, TransportOutcome } from "../application/transport.ts";

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

type Circuit = { state: BreakerState; failures: number; openedAt: number; probing: boolean };

export type CircuitBreaker = {
  /** Si puede llamar ahora; si no, cuándo volver a intentarlo. */
  check(
    environment: Environment,
    service: SriService,
  ): { allowed: true } | { allowed: false; retryAt: Date };
  record(environment: Environment, service: SriService, outcome: TransportOutcome): void;
  state(environment: Environment, service: SriService): BreakerState;
};

/** Un fallo para el breaker: sin respuesta, o una respuesta 5xx del servidor. */
const isFailure = (outcome: TransportOutcome) =>
  outcome.kind !== "RESPONSE" || outcome.httpStatus >= 500;

export function createCircuitBreaker(options: {
  failures: number;
  cooldownMs: number;
  now?: () => number;
}): CircuitBreaker {
  const now = options.now ?? Date.now;
  const circuits = new Map<string, Circuit>();
  const circuit = (environment: Environment, service: SriService) => {
    const key = `${environment}:${service}`;
    let found = circuits.get(key);
    if (!found) {
      found = { state: "CLOSED", failures: 0, openedAt: 0, probing: false };
      circuits.set(key, found);
    }
    if (found.state === "OPEN" && now() - found.openedAt >= options.cooldownMs) {
      found.state = "HALF_OPEN";
      found.probing = false;
    }
    return found;
  };

  return {
    check(environment, service) {
      const current = circuit(environment, service);
      if (current.state === "CLOSED") return { allowed: true };
      if (current.state === "HALF_OPEN" && !current.probing) {
        current.probing = true;
        return { allowed: true };
      }
      const retryAt =
        current.state === "OPEN"
          ? current.openedAt + options.cooldownMs
          : now() + options.cooldownMs;
      return { allowed: false, retryAt: new Date(retryAt) };
    },

    record(environment, service, outcome) {
      const current = circuit(environment, service);
      if (!isFailure(outcome)) {
        current.state = "CLOSED";
        current.failures = 0;
        current.probing = false;
        return;
      }
      current.failures++;
      if (current.state === "HALF_OPEN" || current.failures >= options.failures) {
        current.state = "OPEN";
        current.openedAt = now();
        current.probing = false;
      }
    },

    state: (environment, service) => circuit(environment, service).state,
  };
}

// Operaciones con el SRI para los handlers de la transmisión (add-sri-transmission, design D6, D10 y
// D15): arma el sobre oficial, consulta el circuit breaker y llama al transporte. El dominio decide
// qué consultar y cuándo; aquí solo se habla con los servicios web.
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import type {
  BreakerOpen,
  SriExchange,
  SriGateway,
  SriService,
  SriTransport,
} from "../application/transport.ts";
import type { CircuitBreaker } from "./circuit-breaker.ts";
import { authorizationEnvelope, prepareReception, validityEnvelope } from "./soap-envelopes.ts";

export function createSriGateway(deps: {
  transport: SriTransport;
  breaker: CircuitBreaker;
}): SriGateway {
  async function call(
    environment: Environment,
    service: SriService,
    envelope: () => Buffer,
  ): Promise<SriExchange | BreakerOpen> {
    const decision = deps.breaker.check(environment, service);
    if (!decision.allowed) return { breakerOpen: true, service, retryAt: decision.retryAt };
    const exchange = await deps.transport.exchange({ environment, service, envelope: envelope() });
    deps.breaker.record(environment, service, exchange.outcome);
    return exchange;
  }

  return {
    prepareReception,
    // El cuerpo ya preparado y medido: se entrega tal cual, sin volver a armarlo (design D2).
    submit: (environment, prepared) => call(environment, "RECEPTION", () => prepared.envelope),
    queryAuthorization: (environment, accessKey) =>
      call(environment, "AUTHORIZATION", () => authorizationEnvelope(accessKey)),
    queryValidity: (environment, accessKey) =>
      call(environment, "VALIDITY", () => validityEnvelope(accessKey)),
  };
}

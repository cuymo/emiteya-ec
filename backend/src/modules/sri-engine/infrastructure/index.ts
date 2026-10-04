// Composición del motor SRI (ADR 0018 y 0021): adaptadores que el arranque necesita.
export { createXmllintXsdValidator } from "./xmllint-xsd-validator.ts";
export { verifySchemaBundle } from "./schema-bundle.ts";
// Transporte SOAP propio con el SRI (add-sri-transmission, design D6 y D10).
export { createSoapTransport } from "./soap-transport.ts";
export { endpointsValid, resolveSriEndpoints, type SriEndpoints } from "./endpoints.ts";
export { createCircuitBreaker, type CircuitBreaker } from "./circuit-breaker.ts";
export { createSriGateway } from "./sri-gateway.ts";

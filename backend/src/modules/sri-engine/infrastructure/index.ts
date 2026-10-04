// Composición del motor SRI (ADR 0018 y 0021): adaptadores que el arranque necesita.
export { createXmllintXsdValidator } from "./xmllint-xsd-validator.ts";
export { verifySchemaBundle } from "./schema-bundle.ts";
// Transporte SOAP propio con el SRI (add-sri-transmission, design D6 y D10).
export { createSoapTransport } from "./soap-transport.ts";
export { endpointsValid, resolveSriEndpoints, type SriEndpoints } from "./endpoints.ts";
export { createCircuitBreaker, type CircuitBreaker } from "./circuit-breaker.ts";
export { createSriGateway } from "./sri-gateway.ts";
// Clasificación de las respuestas del SRI (add-sri-transmission, design D11, D12 y D15).
export { RECEPTION_CLASSIFIER_VERSION, classifyReception } from "./reception-classifier.ts";
export {
  AUTHORIZATION_CLASSIFIER_VERSION,
  classifyAuthorization,
} from "./authorization-classifier.ts";
export { VALIDITY_CLASSIFIER_VERSION, classifyValidity } from "./validity-classifier.ts";

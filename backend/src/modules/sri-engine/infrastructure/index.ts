// Composición del motor SRI (ADR 0018 y 0021): adaptadores que el arranque necesita.
import type { SriClassifiers } from "../application/classification.ts";
import {
  AUTHORIZATION_CLASSIFIER_VERSION,
  classifyAuthorization,
} from "./authorization-classifier.ts";
import { RECEPTION_CLASSIFIER_VERSION, classifyReception } from "./reception-classifier.ts";
import { VALIDITY_CLASSIFIER_VERSION, classifyValidity } from "./validity-classifier.ts";

export { createXmllintXsdValidator } from "./xmllint-xsd-validator.ts";
export { verifySchemaBundle } from "./schema-bundle.ts";
// Fuentes del RIDE (add-document-archive, design D7): sin pdfmake, que solo carga su worker.
export { defaultRideFontsDirectory, verifyRideAssets } from "./ride/ride-assets.ts";
export { createPooledRideRenderer, rideTasksEntry } from "./ride/pooled-ride-renderer.ts";
// Transporte SOAP propio con el SRI (add-sri-transmission, design D6 y D10).
export { createSoapTransport } from "./soap-transport.ts";
export { endpointsValid, resolveSriEndpoints, type SriEndpoints } from "./endpoints.ts";
export { createCircuitBreaker, type CircuitBreaker } from "./circuit-breaker.ts";
export { createSriGateway } from "./sri-gateway.ts";
// Clasificación de las respuestas del SRI (add-sri-transmission, design D11, D12 y D15).
export { classifyAuthorization, classifyReception, classifyValidity };

/** Los clasificadores reales, para los handlers de la transmisión. */
export const sriClassifiers: SriClassifiers = {
  reception: classifyReception,
  authorization: classifyAuthorization,
  validity: classifyValidity,
  versions: {
    reception: RECEPTION_CLASSIFIER_VERSION,
    authorization: AUTHORIZATION_CLASSIFIER_VERSION,
    validity: VALIDITY_CLASSIFIER_VERSION,
  },
};

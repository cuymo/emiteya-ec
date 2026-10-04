// Endpoints del SRI por ambiente y servicio (add-sri-transmission, design D10; CTX §7.1–§7.4 y
// §7.5): el único lugar del código con sus URL. Son las direcciones SOAP (`soap:address`) de los
// WSDL oficiales (`docs/product/sri-wsdl/`), sin `?wsdl`. Cada una se puede sobrescribir por
// configuración; la lógica de negocio nunca ve una URL. No se fijan certificados TLS.
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import type { SriService } from "../application/transport.ts";

export type SriEndpoints = Readonly<Record<Environment, Readonly<Record<SriService, string>>>>;

const TEST_BASE = "https://celcer.sri.gob.ec/comprobantes-electronicos-ws";
const PRODUCTION_BASE = "https://cel.sri.gob.ec/comprobantes-electronicos-ws";

export const SRI_DEFAULT_ENDPOINTS: SriEndpoints = {
  TEST: {
    RECEPTION: `${TEST_BASE}/RecepcionComprobantesOffline`,
    AUTHORIZATION: `${TEST_BASE}/AutorizacionComprobantesOffline`,
    VALIDITY: `${TEST_BASE}/ConsultaComprobante`,
  },
  PRODUCTION: {
    RECEPTION: `${PRODUCTION_BASE}/RecepcionComprobantesOffline`,
    AUTHORIZATION: `${PRODUCTION_BASE}/AutorizacionComprobantesOffline`,
    VALIDITY: `${PRODUCTION_BASE}/ConsultaComprobante`,
  },
};

/** Variables `SRI_ENDPOINT_{TEST,PRODUCTION}_{RECEPTION,AUTHORIZATION,VALIDITY}`, ya validadas. */
export type SriEndpointOverrides = Readonly<
  Partial<Record<`SRI_ENDPOINT_${Environment}_${SriService}`, string | undefined>>
>;

export function resolveSriEndpoints(overrides: SriEndpointOverrides = {}): SriEndpoints {
  const resolve = (environment: Environment) => ({
    RECEPTION:
      overrides[`SRI_ENDPOINT_${environment}_RECEPTION`] ??
      SRI_DEFAULT_ENDPOINTS[environment].RECEPTION,
    AUTHORIZATION:
      overrides[`SRI_ENDPOINT_${environment}_AUTHORIZATION`] ??
      SRI_DEFAULT_ENDPOINTS[environment].AUTHORIZATION,
    VALIDITY:
      overrides[`SRI_ENDPOINT_${environment}_VALIDITY`] ??
      SRI_DEFAULT_ENDPOINTS[environment].VALIDITY,
  });
  return { TEST: resolve("TEST"), PRODUCTION: resolve("PRODUCTION") };
}

/**
 * Todos los endpoints son URL absolutas `https`, o `http` solo fuera de producción (un SRI simulado
 * local). Es una precondición de la transmisión habilitada (design D5).
 */
export function endpointsValid(endpoints: SriEndpoints, production: boolean): boolean {
  return Object.values(endpoints).every((services) =>
    Object.values(services).every((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:" || (!production && url.protocol === "http:");
      } catch {
        return false;
      }
    }),
  );
}

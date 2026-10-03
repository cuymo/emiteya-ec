// Consumidor final del sistema (add-parties-and-products, design D5): un tercero por empresa con la
// identidad canónica de la política de consumidor final vigente al crearlo. El dominio lo reconoce
// por su marca, nunca por su texto ni su identificación. No guarda el monto máximo de la política.
import { searchKey } from "../../../platform/search/search-key.ts";

export const CONSUMER_FINAL = "CONSUMER_FINAL" as const;

/** Identidad que publica la política (tipo, identificación y razón social canónica). */
export type ConsumerFinalIdentity = {
  identificationType: string;
  identification: string;
  canonicalName: string;
};

/** Datos del registro del sistema que se insertan para una empresa. */
export function consumerFinalRecord(identity: ConsumerFinalIdentity) {
  return {
    identificationType: identity.identificationType,
    identification: identity.identification,
    legalName: identity.canonicalName,
    roles: ["CUSTOMER"],
    systemRecord: CONSUMER_FINAL,
    searchName: searchKey(identity.canonicalName),
    searchIdentification: searchKey(identity.identification),
  };
}
export type ConsumerFinalRecord = ReturnType<typeof consumerFinalRecord>;

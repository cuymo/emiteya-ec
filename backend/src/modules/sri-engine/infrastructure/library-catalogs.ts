// Valores de los catálogos que trae facturacion-electronica-ec, expuestos solo para la prueba de
// contrato (ADR 0018 y 0020; add-fiscal-catalogs, design D16). No son fuente de nada: los datasets
// del proyecto son la fuente normativa, y una discrepancia nunca se resuelve adoptando estos valores.
import {
  CODIGOS_IMPUESTO,
  FORMAS_PAGO,
  IMPUESTOS_IVA,
  TIPOS_IDENTIFICACION,
} from "facturacion-electronica-ec";

export type LibraryCatalogs = {
  identificationTypes: string[];
  taxCodes: string[];
  paymentMethods: string[];
  /** Código de porcentaje de IVA y la tarifa que la librería le asigna, como texto decimal. */
  ivaRates: { code: string; rate: string }[];
};

const codes = (catalog: Record<string, { code: string }>) =>
  Object.values(catalog)
    .map((entry) => entry.code)
    .sort();

export function libraryCatalogs(): LibraryCatalogs {
  return {
    identificationTypes: codes(TIPOS_IDENTIFICACION),
    taxCodes: codes(CODIGOS_IMPUESTO),
    paymentMethods: codes(FORMAS_PAGO),
    ivaRates: Object.values(IMPUESTOS_IVA)
      .map((entry) => ({ code: entry.code, rate: String(entry.rate) }))
      .sort((a, b) => Number(a.code) - Number(b.code)),
  };
}

// Datos de las pruebas del dominio de la nota de débito: tratamientos de IVA de una factura tal como
// los congela su snapshot (add-debit-notes, design D6).
import type { InvoiceTaxTreatment } from "../../src/modules/debit-notes/domain/treatments.ts";

export function treatment(
  rateCode: string,
  percentage: string,
  officialLabel = `${percentage}%`,
): InvoiceTaxTreatment {
  return {
    key: `2:${rateCode}`,
    taxCode: "2",
    rateCode,
    percentage,
    catalogType: "iva-rate",
    entryKey: rateCode,
    versionId: `iva-${rateCode}`,
    officialLabel,
  };
}

export const IVA_0 = treatment("0", "0");
export const IVA_12 = treatment("2", "12");
export const IVA_15 = treatment("4", "15");
export const IVA_5 = treatment("5", "5");
export const NOT_SUBJECT = treatment("6", "0", "No Objeto de Impuesto");
export const EXEMPT = treatment("7", "0", "Exento de IVA");

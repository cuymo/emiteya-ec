// Tratamientos de IVA de la factura modificada (add-debit-notes, design D6): las combinaciones
// distintas de código y código de porcentaje de los impuestos IVA de sus líneas, con el porcentaje y
// las referencias del catálogo que congeló su snapshot. Son, por construcción, los vigentes en la
// fecha de emisión de la factura: la nota nunca lee el catálogo, el producto ni el tercero vigentes.
import { compareDecimalStrings } from "@facturador/contracts";

/** Código del IVA en la tabla 16 de la ficha técnica: el único impuesto de la nota del MVP. */
export const IVA_TAX_CODE = "2";

/** Impuesto de una línea de la factura tal como lo guarda su snapshot. */
export type InvoiceLineTax = Readonly<{
  taxCode: string;
  rateCode: string;
  catalogType: string;
  entryKey: string;
  versionId: string;
  officialLabel: string;
  percentage: string;
}>;

/** Un tratamiento de IVA de la factura, identificado por `taxCode:rateCode`. */
export type InvoiceTaxTreatment = Readonly<{
  key: string;
  taxCode: string;
  rateCode: string;
  percentage: string;
  catalogType: string;
  entryKey: string;
  versionId: string;
  officialLabel: string;
}>;

export const treatmentKey = (tax: Readonly<{ taxCode: string; rateCode: string }>) =>
  `${tax.taxCode}:${tax.rateCode}`;

const byCode = (a: InvoiceTaxTreatment, b: InvoiceTaxTreatment) =>
  a.taxCode.localeCompare(b.taxCode, "en", { numeric: true }) ||
  a.rateCode.localeCompare(b.rateCode, "en", { numeric: true });

/**
 * Los tratamientos de IVA de la factura, sin repetir y en el orden de los totales de la factura.
 * La factura tiene un solo porcentaje por tratamiento; si el snapshot trajera dos, falla.
 */
export function invoiceTaxTreatments(
  lines: readonly Readonly<{ taxes: readonly InvoiceLineTax[] }>[],
): InvoiceTaxTreatment[] {
  const found = new Map<string, InvoiceTaxTreatment>();
  for (const tax of lines.flatMap((line) => line.taxes)) {
    if (tax.taxCode !== IVA_TAX_CODE) continue;
    const key = treatmentKey(tax);
    const existing = found.get(key);
    if (existing) {
      if (compareDecimalStrings(existing.percentage, tax.percentage) !== 0) {
        throw new Error(`El tratamiento ${key} tiene dos porcentajes en la factura.`);
      }
      continue;
    }
    found.set(key, {
      key,
      taxCode: tax.taxCode,
      rateCode: tax.rateCode,
      percentage: tax.percentage,
      catalogType: tax.catalogType,
      entryKey: tax.entryKey,
      versionId: tax.versionId,
      officialLabel: tax.officialLabel,
    });
  }
  return [...found.values()].sort(byCode);
}

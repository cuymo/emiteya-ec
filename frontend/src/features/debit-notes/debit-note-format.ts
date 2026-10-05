// Presentación de los tratamientos de IVA de la nota de débito (add-debit-notes, design D23).
import type { DebitNoteTaxTreatmentView } from "@facturador/contracts";
import { formatPercentage } from "@/lib/decimal";

/** Una denominación oficial que es solo un porcentaje, como "15%". */
const BARE_PERCENTAGE = /^\d+(?:[.,]\d+)?\s*%$/;

/**
 * Nombre de un tratamiento para el usuario: la denominación oficial congelada en la factura cuando
 * dice qué es ("Exento de IVA", "No Objeto de Impuesto"), o "IVA 15 %" cuando es solo un porcentaje,
 * como en la nota de crédito. Es presentación: el snapshot y el XML no cambian.
 */
export const treatmentLabel = (
  treatment: Pick<DebitNoteTaxTreatmentView, "label" | "percentage">,
) =>
  BARE_PERCENTAGE.test(treatment.label.trim())
    ? `IVA ${formatPercentage(treatment.percentage)}`
    : treatment.label;

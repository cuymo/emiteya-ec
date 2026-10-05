// Vista previa de una nota de débito (add-debit-notes, design D7 y D20): pura, desde la evaluación y
// su cálculo único. Muestra los tratamientos de la factura (las únicas opciones de un concepto), las
// bases y los impuestos por tratamiento, el valor total, la forma de pago con su total y todos los
// problemas. No calcula nada propio: los mismos importes congelará la emisión en el snapshot.
import type { DebitNotePreviewView } from "@facturador/contracts";
import type { DebitNoteEvaluation } from "./evaluation.ts";
import type { InvoiceTaxTreatment } from "./treatments.ts";

export function debitNotePreview(
  treatments: readonly InvoiceTaxTreatment[],
  evaluation: DebitNoteEvaluation,
  evaluatedOn: string,
): DebitNotePreviewView {
  const labels = new Map(treatments.map((treatment) => [treatment.key, treatment.officialLabel]));
  const { amounts, payment } = evaluation;
  return {
    evaluatedOn,
    taxTreatments: treatments.map(({ key, taxCode, rateCode, percentage, officialLabel }) => ({
      key,
      taxCode,
      rateCode,
      percentage,
      label: officialLabel,
    })),
    totals: amounts
      ? {
          withoutTaxes: amounts.withoutTaxes,
          taxes: amounts.taxes.map(({ key, taxCode, rateCode, percentage, base, amount }) => ({
            key,
            taxCode,
            rateCode,
            percentage,
            label: labels.get(key) ?? key,
            base,
            amount,
          })),
          total: amounts.total,
        }
      : null,
    payment: payment
      ? {
          entryKey: payment.entryKey,
          code: payment.code,
          label: payment.officialLabel,
          amount: payment.amount,
        }
      : null,
    issues: [...evaluation.issues],
  };
}

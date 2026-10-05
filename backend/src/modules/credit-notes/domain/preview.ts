// Vista previa de una nota de crédito (add-credit-notes, design D5 y D6): pura, desde la evaluación
// y su cálculo único. Muestra las líneas con sus importes, lo acreditable que queda, el retorno
// físico y si la línea lo admite, los totales y todos los problemas. No calcula nada propio: los
// mismos importes congelará la emisión en el snapshot.
import type { CreditNotePreviewView } from "@facturador/contracts";
import type { CreditInvoice, CreditNoteEvaluation } from "./evaluation.ts";

export function creditNotePreview(
  invoice: CreditInvoice,
  evaluation: CreditNoteEvaluation,
  evaluatedOn: string,
): CreditNotePreviewView {
  const byPosition = new Map(invoice.lines.map((line) => [line.position, line]));
  const calculated = new Map(evaluation.amounts?.lines.map((line) => [line.position, line]) ?? []);
  const capacity = new Map(
    evaluation.amounts?.capacity.lines.map((line) => [line.position, line]) ?? [],
  );
  return {
    evaluatedOn,
    lines: evaluation.lines.flatMap((requested) => {
      const original = byPosition.get(requested.position);
      const amounts = calculated.get(requested.position);
      if (!original || !amounts) return [];
      return [
        {
          position: requested.position,
          mainCode: original.mainCode,
          description: original.description,
          quantity: amounts.quantity,
          unitPrice: amounts.unitPrice,
          discount: amounts.discount,
          taxableBase: amounts.taxableBase,
          taxes: amounts.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
            taxCode,
            rateCode,
            percentage,
            base,
            amount,
          })),
          physicalReturn: requested.physicalReturn,
          physicalReturnAllowed: original.inventoryAffectsStock,
          remainingQuantity: capacity.get(requested.position)?.remaining ?? original.quantity,
        },
      ];
    }),
    totals:
      evaluation.issues.length === 0 && evaluation.amounts?.totals
        ? {
            withoutTaxes: evaluation.amounts.totals.withoutTaxes,
            taxes: evaluation.amounts.totals.taxes.map((tax) => ({ ...tax })),
            total: evaluation.amounts.totals.total,
          }
        : null,
    issues: [...evaluation.issues],
  };
}

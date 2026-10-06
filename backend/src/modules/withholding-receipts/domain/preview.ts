// Vista previa de un comprobante de retención (add-withholding-receipts, design D5, D13 y D21):
// pura, desde la evaluación y su cálculo único. Muestra, por documento, las retenciones calculadas
// con el código, la denominación, el porcentaje y el valor del servidor; el total retenido; el aviso
// del período distinto del mes de emisión; y todos los problemas. No calcula nada propio: los mismos
// valores congelará la emisión en el snapshot.
import type { WithholdingPreviewView } from "@facturador/contracts";
import type { WithholdingEvaluation } from "./evaluation.ts";

export function withholdingPreview(
  evaluation: WithholdingEvaluation,
  evaluatedOn: string,
  supportCount: number,
): WithholdingPreviewView {
  return {
    evaluatedOn,
    issueMonth: evaluation.issueMonth,
    periodDiffersFromIssueMonth: evaluation.periodDiffersFromIssueMonth,
    supports: Array.from({ length: supportCount }, (_, index) => ({
      position: index + 1,
      withholdings: evaluation.computed
        .filter((amount) => amount.support === index + 1)
        .map(({ position, base, percentage, amount, item }) => ({
          position,
          tax: item.tax,
          entryKey: item.entry.entryKey,
          code: item.entry.code,
          label: item.entry.officialLabel,
          base,
          percentage,
          amount,
        })),
    })),
    totals: evaluation.amounts ? { withheld: evaluation.amounts.withheld } : null,
    issues: [...evaluation.issues],
  };
}

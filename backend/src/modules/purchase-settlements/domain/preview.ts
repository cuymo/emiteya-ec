// Vista previa de una liquidación de compra (add-purchase-settlements, design D8, D10 y D12): pura,
// desde la evaluación y su cálculo único. Muestra los importes de cada línea que pudo calcularse, los
// totales, la suma de los pagos para ver la diferencia, la política de procedencia con las cuatro
// declaraciones que se confirmarán al emitir, el aviso de la retención y todos los problemas. No
// calcula nada propio: los mismos importes congelará la emisión en el snapshot.
import {
  PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY,
  PURCHASE_SETTLEMENT_STATEMENTS,
  PURCHASE_SETTLEMENT_STATEMENT_TEXTS,
  PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
  type PurchaseSettlementPolicyView,
  type PurchaseSettlementPreviewView,
  type RateKind,
} from "@facturador/contracts";
import { PURCHASE_SETTLEMENT_CALCULATION_VERSION } from "./amounts.ts";
import type { PurchaseSettlementEvaluation } from "./evaluation.ts";

/** La política vigente con el texto de sus declaraciones, para la vista previa y las opciones. */
export const purchaseSettlementPolicyView = (): PurchaseSettlementPolicyView => ({
  id: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.id,
  rule: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.rule,
  case: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.case,
  version: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.version,
  source: PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.source,
  statements: PURCHASE_SETTLEMENT_STATEMENTS.map((id) => ({
    id,
    text: PURCHASE_SETTLEMENT_STATEMENT_TEXTS[id],
  })),
});

export function purchaseSettlementPreview(
  evaluation: PurchaseSettlementEvaluation,
  evaluatedOn: string,
): PurchaseSettlementPreviewView {
  const resolved = new Map(evaluation.lines.map((line) => [line.position, line]));
  const label = (rateCode: string) =>
    evaluation.lines.find((line) => line.iva.entry.code === rateCode)?.iva;
  return {
    evaluatedOn,
    calculationVersion: PURCHASE_SETTLEMENT_CALCULATION_VERSION,
    supplier: evaluation.supplier
      ? {
          identificationType: evaluation.supplier.identificationType,
          identification: evaluation.supplier.identification,
          legalName: evaluation.supplier.legalName,
        }
      : null,
    lines: evaluation.computed.map((amount) => {
      const iva = resolved.get(amount.position)?.iva;
      return {
        position: amount.position,
        subtotal: amount.subtotal,
        discount: amount.discount,
        taxableBase: amount.taxableBase,
        tax: iva
          ? {
              taxCode: "2" as const,
              rateCode: amount.tax.rateCode,
              rateKind: iva.rateKind as RateKind,
              percentage: amount.tax.percentage,
              label: iva.entry.officialLabel,
              base: amount.tax.base,
              amount: amount.tax.amount,
            }
          : null,
      };
    }),
    totals: evaluation.amounts
      ? {
          withoutTaxes: evaluation.amounts.totals.withoutTaxes,
          discount: evaluation.amounts.totals.discount,
          taxes: evaluation.amounts.totals.taxes.map((tax) => {
            const iva = label(tax.rateCode);
            return {
              taxCode: "2" as const,
              rateCode: tax.rateCode,
              rateKind: (iva?.rateKind ?? "PERCENTAGE") as RateKind,
              percentage: tax.percentage,
              label: iva?.entry.officialLabel ?? tax.rateCode,
              base: tax.base,
              amount: tax.amount,
            };
          }),
          total: evaluation.amounts.totals.total,
        }
      : null,
    paymentsTotal: evaluation.paymentsTotal,
    policy: purchaseSettlementPolicyView(),
    withholdingNotice: PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
    issues: [...evaluation.issues],
  };
}

// Importes de la liquidación de compra en los reportes (add-reports-export, design D5): de `totals`
// de su snapshot, que solo tiene IVA.
import {
  jsonAmount,
  sumTaxAmounts,
  type ReportAmountProjection,
} from "../../fiscal/infrastructure/reports/amount-projections.ts";

export const purchaseSettlementReportAmounts: ReportAmountProjection = {
  documentType: "03",
  subtotal: (snapshot) => jsonAmount(snapshot, "totals", "withoutTaxes"),
  taxes: (snapshot) => sumTaxAmounts(snapshot, ["totals", "taxes"]),
};

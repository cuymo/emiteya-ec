// Importes de la nota de crédito en los reportes (add-reports-export, design D5): los suyos, de
// `totals` de su snapshot, nunca restados de la factura.
import {
  jsonAmount,
  sumTaxAmounts,
  type ReportAmountProjection,
} from "../../fiscal/infrastructure/reports/amount-projections.ts";

export const creditNoteReportAmounts: ReportAmountProjection = {
  documentType: "04",
  subtotal: (snapshot) => jsonAmount(snapshot, "totals", "withoutTaxes"),
  taxes: (snapshot) => sumTaxAmounts(snapshot, ["totals", "taxes"]),
};

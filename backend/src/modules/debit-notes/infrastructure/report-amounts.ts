// Importes de la nota de débito en los reportes (add-reports-export, design D5): el subtotal de
// `totals` y los impuestos del nivel superior del snapshot, uno por tratamiento usado.
import {
  jsonAmount,
  sumTaxAmounts,
  type ReportAmountProjection,
} from "../../fiscal/infrastructure/reports/amount-projections.ts";

export const debitNoteReportAmounts: ReportAmountProjection = {
  documentType: "05",
  subtotal: (snapshot) => jsonAmount(snapshot, "totals", "withoutTaxes"),
  taxes: (snapshot) => sumTaxAmounts(snapshot, ["taxes"]),
};

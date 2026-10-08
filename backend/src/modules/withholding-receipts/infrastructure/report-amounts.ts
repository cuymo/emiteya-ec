// Importes del comprobante de retención en los reportes (add-reports-export, design D5): solo su
// total retenido, que el comprobante congela como su total; no tiene subtotal ni impuestos propios.
import type { ReportAmountProjection } from "../../fiscal/infrastructure/reports/amount-projections.ts";

export const withholdingReportAmounts: ReportAmountProjection = {
  documentType: "07",
  subtotal: null,
  taxes: null,
};

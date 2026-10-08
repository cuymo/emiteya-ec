// Importes de la guía de remisión en los reportes (add-reports-export, design D5): ninguno. La guía
// no es un documento monetario, y el reporte nunca le inventa un 0.00.
import type { ReportAmountProjection } from "../../fiscal/infrastructure/reports/amount-projections.ts";

export const shippingGuideReportAmounts: ReportAmountProjection = {
  documentType: "06",
  subtotal: null,
  taxes: null,
};

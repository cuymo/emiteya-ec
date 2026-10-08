// Importes de la factura en los reportes (add-reports-export, design D5): su snapshot los congela en
// `totals`, con cada impuesto por código. Facturas separa el IVA de los otros impuestos.
import {
  jsonAmount,
  sumTaxAmounts,
  type InvoiceTaxProjection,
  type ReportAmountProjection,
} from "../../fiscal/infrastructure/reports/amount-projections.ts";

const TAXES = ["totals", "taxes"] as const;

export const invoiceReportAmounts: ReportAmountProjection = {
  documentType: "01",
  subtotal: (snapshot) => jsonAmount(snapshot, "totals", "withoutTaxes"),
  taxes: (snapshot) => sumTaxAmounts(snapshot, TAXES),
};

export const invoiceReportTaxes: InvoiceTaxProjection = {
  subtotal: (snapshot) => jsonAmount(snapshot, "totals", "withoutTaxes"),
  vat: (snapshot) => sumTaxAmounts(snapshot, TAXES, "vat"),
  otherTaxes: (snapshot) => sumTaxAmounts(snapshot, TAXES, "notVat"),
};

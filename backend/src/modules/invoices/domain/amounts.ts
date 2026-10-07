// Importes de la factura (add-invoice-emission, design D5; Q-14). Las primitivas viven en el módulo
// fiscal neutral `fiscal/domain/document-amounts.ts`, que comparten la factura y la liquidación de
// compra (add-purchase-settlements, design D8); la factura las usa con sus nombres de siempre y sus
// resultados no cambian. Tres puntos de materialización HALF_UP: la base de la línea, su impuesto y
// los totales. El builder XML no calcula: escribe lo que devuelven estas funciones.
export {
  DocumentAmountError as InvoiceAmountError,
  documentTotals as invoiceTotals,
  lineAmounts,
  lineDiscount,
  lineSubtotal,
  materializeMoney,
  taxAmount,
  taxableBase,
  type AmountField,
  type DocumentAmountErrorCode as InvoiceAmountErrorCode,
  type DocumentTotals as InvoiceTotals,
  type LineAmounts,
  type LineInput,
  type LineTax,
  type LineTaxRate,
  type TaxTotal,
} from "../../fiscal/domain/document-amounts.ts";

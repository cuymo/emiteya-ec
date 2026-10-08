// Cálculo único de los importes de una liquidación de compra (add-purchase-settlements, design D8): la
// única autoridad de la vista previa, del snapshot, del XML y del RIDE. Usa las primitivas fiscales
// neutrales que comparte con la factura (`fiscal/domain/document-amounts.ts`), equivalentes a las
// fórmulas del anexo 17 de la ficha v2.34 sin propina, ICE, IRBPNR ni reembolsos:
//   subtotal de la línea   = cantidad × precio unitario              (exacto)
//   base de la línea       = round(subtotal − descuento)             (`precioTotalSinImpuesto`)
//   IVA de la línea        = round(base × tarifa / 100)
//   base e IVA por tarifa  = suma de las bases y de los IVA de sus líneas
//   total sin impuestos    = suma de las bases; importe total = total sin impuestos + IVA
// con round = HALF_UP a 2 decimales en esos tres puntos. Sin `number`: todo es `DecimalString` exacto.
import {
  documentTotals,
  lineAmounts,
  type DocumentTotals,
} from "../../fiscal/domain/document-amounts.ts";

/** Versión del cálculo: cambia con cualquier cambio de sus resultados para la misma entrada. */
export const PURCHASE_SETTLEMENT_CALCULATION_VERSION = "purchase-settlement-amounts-1";

/** El IVA del catálogo vigente de una línea: código de porcentaje y tarifa de cálculo. */
export type LineIvaRate = Readonly<{ rateCode: string; percentage: string }>;

export type PurchaseSettlementLineInput = Readonly<{
  position: number;
  quantity: string;
  unitPrice: string;
  discount: string;
  rate: LineIvaRate;
}>;

export type PurchaseSettlementLineAmounts = Readonly<{
  position: number;
  /** Cantidad por precio unitario, exacto: no es un campo del XML. */
  subtotal: string;
  discount: string;
  /** `precioTotalSinImpuesto` de la línea y base de su IVA. */
  taxableBase: string;
  tax: Readonly<{
    taxCode: "2";
    rateCode: string;
    percentage: string;
    base: string;
    amount: string;
  }>;
}>;

export type PurchaseSettlementAmounts = Readonly<{
  calculationVersion: typeof PURCHASE_SETTLEMENT_CALCULATION_VERSION;
  lines: readonly PurchaseSettlementLineAmounts[];
  totals: DocumentTotals;
}>;

/** Importes de una línea; lanza `DocumentAmountError` si un dato o un importe no cabe. */
export function purchaseSettlementLineAmounts(
  line: PurchaseSettlementLineInput,
): PurchaseSettlementLineAmounts {
  const amounts = lineAmounts({
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount: line.discount,
    taxes: [{ taxCode: "2", rateCode: line.rate.rateCode, percentage: line.rate.percentage }],
  });
  const tax = amounts.taxes[0]!;
  return {
    position: line.position,
    subtotal: amounts.subtotal,
    discount: amounts.discount,
    taxableBase: amounts.taxableBase,
    tax: {
      taxCode: "2",
      rateCode: tax.rateCode,
      percentage: tax.percentage,
      base: tax.base,
      amount: tax.amount,
    },
  };
}

/**
 * Importes de todas las líneas y sus totales. Lanza `DocumentAmountError` si una línea o un total no
 * cabe en el XSD; quien llama lo informa junto a su línea.
 */
export function calculatePurchaseSettlementAmounts(
  lines: readonly PurchaseSettlementLineInput[],
): PurchaseSettlementAmounts {
  const computed = lines.map(purchaseSettlementLineAmounts);
  return {
    calculationVersion: PURCHASE_SETTLEMENT_CALCULATION_VERSION,
    lines: computed,
    totals: documentTotals(
      computed.map((line) => ({
        subtotal: line.subtotal,
        discount: line.discount,
        taxableBase: line.taxableBase,
        taxes: [line.tax],
      })),
    ),
  };
}

// Mercancías sugeridas de una factura sustento (add-shipping-guides, design D9): una sugerencia de
// interfaz no autoritativa. Cada línea del snapshot de la factura conserva sus datos históricos
// (códigos, descripción y cantidad facturada). El snapshot no congela el tipo bien/servicio, así que
// el tipo vigente del producto solo decide qué se sugiere: `PRODUCT` si hoy es un bien activo,
// `FREE_LINE` si no, para agregarse como línea libre. Nunca rotula una línea como servicio ni como no
// trasladable, no valida la factura ni decide la elegibilidad de la guía.
import type { ShippingInvoiceGoodsView } from "@facturador/contracts";
import type { GuideInvoiceSource, ShippingProductReader } from "./ports.ts";

export async function suggestedGoods(
  products: ReturnType<ShippingProductReader>,
  companyId: string,
  invoice: GuideInvoiceSource,
): Promise<ShippingInvoiceGoodsView> {
  const lines: ShippingInvoiceGoodsView["lines"] = [];
  for (const line of invoice.lines) {
    const product = await products.find(companyId, line.productId);
    const resolvable = product?.status === "ACTIVE" && product.kind === "GOOD";
    lines.push({
      position: line.position,
      suggestion: resolvable ? "PRODUCT" : "FREE_LINE",
      productId: resolvable ? line.productId : null,
      mainCode: line.mainCode,
      auxiliaryCode: line.auxiliaryCode,
      description: line.description,
      quantity: line.quantity,
    });
  }
  return { invoiceId: invoice.id, documentNumber: invoice.documentNumber, lines };
}

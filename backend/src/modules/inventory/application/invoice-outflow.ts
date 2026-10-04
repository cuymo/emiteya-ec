// Salida de inventario de una factura autorizada (add-minimal-inventory, design D5): un seguidor del
// puerto genérico de las transiciones, que compone el arranque. Al entrar en `AUTHORIZED`, con el
// cliente de la misma transacción, registra una salida por producto con la suma exacta de las
// líneas que afectan al inventario según la decisión congelada al reservar. Nunca lee el producto
// vigente, nunca falla por un saldo insuficiente (el saldo puede quedar negativo, Q-19) y, si algo
// falla, la autorización entera se revierte y se vuelve a aplicar desde la respuesta guardada.
import type { DbClient } from "../../../platform/db/database.ts";
import type { DocumentTransitionFollower } from "../../fiscal/application/document-transitions.ts";
import { negate, outflowsOf, type InvoiceStockLine } from "../domain/stock.ts";
import type { StockRepository } from "./ports.ts";

/** Factura con su número y sus líneas de inventario: la lectura interna de `invoices`. */
export type InvoiceStockLinesReader = (db: DbClient) => {
  of(
    companyId: string,
    documentId: string,
  ): Promise<Readonly<{ documentNumber: string; lines: readonly InvoiceStockLine[] }> | null>;
};

export function inventoryOutflowFollower(
  deps: Readonly<{
    invoices: InvoiceStockLinesReader;
    stock: (db: DbClient) => StockRepository;
    /** Una salida registrada (métrica `inventory_movements_total`). */
    onOutflow?: () => void;
  }>,
): DocumentTransitionFollower {
  return async (db, event) => {
    if (event.to !== "AUTHORIZED") return;
    const invoice = await deps.invoices(db).of(event.companyId, event.documentId);
    if (!invoice) return;
    const stock = deps.stock(db);
    // En orden estable de producto: dos facturas bloquean sus saldos en el mismo orden.
    for (const outflow of outflowsOf(invoice.lines)) {
      // La autorización no se repite, pero una salida ya registrada nunca toca el saldo; la
      // unicidad de la base es la última defensa.
      if (await stock.findOutflow(event.companyId, event.documentId, outflow.productId)) continue;
      await stock.append({
        companyId: event.companyId,
        productId: outflow.productId,
        type: "SALIDA_FACTURA",
        delta: negate(outflow.quantity),
        origin: "SYSTEM",
        actorUserId: null,
        documentId: event.documentId,
        documentNumber: invoice.documentNumber,
        occurredAt: event.at,
      });
      deps.onOutflow?.();
    }
  };
}

// Líneas de inventario de una factura (add-minimal-inventory, design D1 y D5): la lectura interna que
// usa el seguidor de la autorización del inventario, sobre el cliente de su transacción. Devuelve
// solo lo inmutable del snapshot: el número, y por línea el producto, la cantidad y la decisión de
// inventario congelada al reservar. Nunca lee el producto vigente.
import type { DbClient } from "../../../platform/db/database.ts";
import { createDocumentRepository } from "../../fiscal/infrastructure/index.ts";
import { lineAffectsInventory, type InvoiceSnapshot } from "../domain/snapshot.ts";
import { INVOICE_DOCUMENT_TYPE } from "../application/evaluation.ts";

export type InvoiceStockDocument = Readonly<{
  documentId: string;
  documentNumber: string;
  lines: readonly Readonly<{
    productId: string;
    quantity: string;
    inventoryAffectsStock: boolean;
  }>[];
}>;

export function invoiceStockLines(db: DbClient) {
  const documents = createDocumentRepository(db);
  return {
    /** La factura con sus líneas; null si no existe en la empresa o no es una factura. */
    async of(companyId: string, documentId: string): Promise<InvoiceStockDocument | null> {
      const document = await documents.find(companyId, documentId);
      if (!document || document.documentType !== INVOICE_DOCUMENT_TYPE) return null;
      const snapshot = document.snapshot as InvoiceSnapshot;
      return {
        documentId: document.id,
        documentNumber: document.documentNumber,
        lines: (snapshot.lines ?? []).map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          inventoryAffectsStock: lineAffectsInventory(snapshot, line),
        })),
      };
    },
  };
}

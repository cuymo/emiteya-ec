// Devolución de stock de una nota de crédito autorizada (add-credit-notes, design D10 y D25): un
// seguidor de las transiciones del comprobante, que compone el arranque después del de la capacidad
// acreditable. Lee solo las reservas devolvibles de la nota (el inventario no importa
// `credit-notes`). Al entrar en `AUTHORIZED`, por producto en orden estable: la reserva pasa a
// aplicada con una actualización guardada y se agrega una `DEVOLUCION_NC` positiva con la cantidad
// exacta, que referencia la nota con su número. En `RETURNED` o `NOT_AUTHORIZED`, las reservas se
// liberan sin movimientos. En otro estado, nada. El control vigente del producto no se consulta y un
// saldo negativo no impide la devolución. Si algo falla, la transición entera se revierte y el
// reintento la vuelve a aplicar desde la respuesta guardada del SRI.
import type { DbClient } from "../../../platform/db/database.ts";
import type { DocumentTransitionFollower } from "../../fiscal/application/document-transitions.ts";
import type { StockRepository } from "./ports.ts";

/** Retorno físico reservado por una nota para un producto. */
export type StockReturnReservation = Readonly<{ productId: string; quantity: string }>;

export type StockReturnReservations = {
  /** Las reservas `RESERVED` de la nota, en orden estable de `productId`. */
  reservedOf(companyId: string, creditNoteId: string): Promise<readonly StockReturnReservation[]>;
  /**
   * Aplica o libera la reserva de la nota y el producto con una actualización guardada por estado,
   * y mueve la cantidad en la capacidad devolvible. false si ya no estaba `RESERVED`.
   */
  conclude(
    companyId: string,
    creditNoteId: string,
    productId: string,
    outcome: "APPLIED" | "RELEASED",
    at: Date,
  ): Promise<boolean>;
};

/** Número del comprobante desde `fiscal`, la misma lectura que usa para la factura. */
export type DocumentNumberReader = (db: DbClient) => {
  find(companyId: string, documentId: string): Promise<Readonly<{ documentNumber: string }> | null>;
};

export function creditNoteReturnFollower(
  deps: Readonly<{
    returns: (db: DbClient) => StockReturnReservations;
    stock: (db: DbClient) => StockRepository;
    documents: DocumentNumberReader;
    /** Una devolución registrada (métrica `inventory_movements_total`). */
    onReturn?: () => void;
  }>,
): DocumentTransitionFollower {
  return async (db, event) => {
    const applied = event.to === "AUTHORIZED";
    if (!applied && event.to !== "RETURNED" && event.to !== "NOT_AUTHORIZED") return;
    const returns = deps.returns(db);
    const reservations = await returns.reservedOf(event.companyId, event.documentId);
    if (reservations.length === 0) return;
    if (!applied) {
      for (const reservation of reservations) {
        await returns.conclude(
          event.companyId,
          event.documentId,
          reservation.productId,
          "RELEASED",
          event.at,
        );
      }
      return;
    }
    const note = await deps.documents(db).find(event.companyId, event.documentId);
    if (!note) throw new Error("La nota de crédito de la devolución no existe.");
    const stock = deps.stock(db);
    for (const reservation of reservations) {
      if (
        !(await returns.conclude(
          event.companyId,
          event.documentId,
          reservation.productId,
          "APPLIED",
          event.at,
        ))
      ) {
        continue;
      }
      await stock.append({
        companyId: event.companyId,
        productId: reservation.productId,
        type: "DEVOLUCION_NC",
        delta: reservation.quantity,
        origin: "SYSTEM",
        actorUserId: null,
        documentId: event.documentId,
        documentNumber: note.documentNumber,
        occurredAt: event.at,
      });
      deps.onReturn?.();
    }
  };
}

// Seguidores de las transiciones del comprobante (add-document-archive, design D1 y D5): un puerto
// genérico que no conoce a nadie. La transmisión lo invoca en la misma transacción que guarda cada
// transición, y otra capacidad (el archivo documental) lo implementa; `main.ts` los compone al
// arrancar. Así la transmisión no depende de las capacidades posteriores, y lo que sigue a una
// transición (como el job del RIDE al autorizar) se confirma con ella o no se confirma.
import type { DbClient } from "../../../platform/db/database.ts";
import type { DocumentState, TransitionCause } from "../domain/document.ts";

export type DocumentTransitionEvent = Readonly<{
  companyId: string;
  documentId: string;
  from: DocumentState;
  to: DocumentState;
  cause: TransitionCause;
  at: Date;
}>;

/**
 * Corre con el cliente de la transacción de la transición; si lanza, la transacción entera se
 * revierte y la transición no ocurre.
 */
export type DocumentTransitionFollower = (
  db: DbClient,
  event: DocumentTransitionEvent,
) => Promise<void>;

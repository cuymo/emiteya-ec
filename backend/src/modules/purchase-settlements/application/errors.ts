// Errores de las liquidaciones de compra con código estable para la API (add-purchase-settlements,
// design D21). Los rechazos antes de reservar son `409` con el código y el mensaje del primer
// problema; un recurso de otra empresa es `404` igual que uno inexistente.
import type { PurchaseSettlementIssue } from "@facturador/contracts";
import { AppError, ConflictError, NotFoundError } from "../../../platform/http/errors.ts";

export const draftNotFound = () =>
  new NotFoundError(
    "PURCHASE_SETTLEMENT_DRAFT_NOT_FOUND",
    "El borrador de liquidación de compra no existe.",
  );

export const settlementNotFound = () =>
  new NotFoundError("PURCHASE_SETTLEMENT_NOT_FOUND", "La liquidación de compra no existe.");

export const supplierNotFound = () =>
  new NotFoundError(
    "PURCHASE_SETTLEMENT_SUPPLIER_NOT_FOUND",
    "El proveedor no existe en tu empresa.",
  );

export const productNotFound = () =>
  new NotFoundError(
    "PURCHASE_SETTLEMENT_PRODUCT_NOT_FOUND",
    "El producto no existe en tu empresa.",
  );

export const draftChanged = () =>
  new ConflictError(
    "PURCHASE_SETTLEMENT_DRAFT_CHANGED",
    "Otro usuario cambió este borrador después de que lo abriste. Recarga para ver sus datos.",
  );

export class DraftAlreadyEmittedError extends ConflictError {
  readonly purchaseSettlementId: string | null;
  constructor(purchaseSettlementId: string | null) {
    super(
      "PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED",
      "Este borrador ya se emitió como liquidación de compra; no se puede cambiar ni emitir otra vez.",
    );
    this.purchaseSettlementId = purchaseSettlementId;
  }
}

/** Referencia del borrador que no existe en la empresa (`400`). */
export const invalidReference = (code: "EMISSION_POINT_NOT_FOUND", message: string) =>
  new AppError(code, 400, message);

/** Rechazo antes de reservar, o un borrador fuera de los límites: el primer problema (design D13). */
export class PurchaseSettlementRejectedError extends ConflictError {
  readonly issue: PurchaseSettlementIssue;
  constructor(issue: PurchaseSettlementIssue) {
    super(issue.code, issue.message);
    this.issue = issue;
  }
}

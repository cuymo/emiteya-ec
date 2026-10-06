// Errores de los comprobantes de retención con código estable para la API (add-withholding-receipts,
// design D21). Los rechazos antes de reservar son `409` con el código y el mensaje del primer
// problema; un recurso de otra empresa es `404` igual que uno inexistente.
import type { WithholdingIssue } from "@facturador/contracts";
import { AppError, ConflictError, NotFoundError } from "../../../platform/http/errors.ts";

export const draftNotFound = () =>
  new NotFoundError("WITHHOLDING_DRAFT_NOT_FOUND", "El borrador de retención no existe.");

export const withholdingNotFound = () =>
  new NotFoundError("WITHHOLDING_RECEIPT_NOT_FOUND", "El comprobante de retención no existe.");

export const subjectNotFound = () =>
  new NotFoundError("WITHHOLDING_SUBJECT_NOT_FOUND", "El proveedor no existe en tu empresa.");

export const draftChanged = () =>
  new ConflictError(
    "WITHHOLDING_DRAFT_CHANGED",
    "Otro usuario cambió este borrador después de que lo abriste. Recarga para ver sus datos.",
  );

export class DraftAlreadyEmittedError extends ConflictError {
  readonly withholdingReceiptId: string | null;
  constructor(withholdingReceiptId: string | null) {
    super(
      "WITHHOLDING_DRAFT_ALREADY_EMITTED",
      "Este borrador ya se emitió como comprobante de retención; no se puede cambiar ni emitir otra vez.",
    );
    this.withholdingReceiptId = withholdingReceiptId;
  }
}

/** Referencia del borrador que no existe en la empresa (`400`). */
export const invalidReference = (code: "EMISSION_POINT_NOT_FOUND", message: string) =>
  new AppError(code, 400, message);

/** Rechazo antes de reservar, o un borrador fuera de los límites: el primer problema (design D15). */
export class WithholdingRejectedError extends ConflictError {
  readonly issue: WithholdingIssue;
  constructor(issue: WithholdingIssue) {
    super(issue.code, issue.message);
    this.issue = issue;
  }
}

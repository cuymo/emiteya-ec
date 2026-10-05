// Errores de las notas de crédito con código estable para la API (add-credit-notes, design D16).
// Los rechazos antes de reservar son `409` con el código y el mensaje del primer problema; un
// recurso de otra empresa es `404` igual que uno inexistente.
import type { CreditNoteIssue } from "@facturador/contracts";
import { AppError, ConflictError, NotFoundError } from "../../../platform/http/errors.ts";

export const draftNotFound = () =>
  new NotFoundError("CREDIT_NOTE_DRAFT_NOT_FOUND", "El borrador de nota de crédito no existe.");

export const creditNoteNotFound = () =>
  new NotFoundError("CREDIT_NOTE_NOT_FOUND", "La nota de crédito no existe.");

export const invoiceNotFound = () =>
  new NotFoundError("CREDIT_NOTE_INVOICE_NOT_FOUND", "La factura no existe.");

export const draftChanged = () =>
  new ConflictError(
    "CREDIT_NOTE_DRAFT_CHANGED",
    "Otro usuario cambió este borrador después de que lo abriste. Recarga para ver sus datos.",
  );

export class DraftAlreadyEmittedError extends ConflictError {
  readonly creditNoteId: string | null;
  constructor(creditNoteId: string | null) {
    super(
      "CREDIT_NOTE_DRAFT_ALREADY_EMITTED",
      "Este borrador ya se emitió como nota de crédito; no se puede cambiar ni emitir otra vez.",
    );
    this.creditNoteId = creditNoteId;
  }
}

/** Referencia del borrador que no existe en la factura o en la empresa (`400`). */
export const invalidReference = (
  code:
    "EMISSION_POINT_NOT_FOUND" | "CREDIT_NOTE_LINE_INVALID" | "CREDIT_NOTE_PHYSICAL_RETURN_INVALID",
  message: string,
) => new AppError(code, 400, message);

/** Rechazo antes de reservar: el primer problema de la evaluación (design D4). */
export class CreditNoteRejectedError extends ConflictError {
  readonly issue: CreditNoteIssue;
  constructor(issue: CreditNoteIssue) {
    super(issue.code, issue.message);
    this.issue = issue;
  }
}

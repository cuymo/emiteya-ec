// Errores de las notas de débito con código estable para la API (add-debit-notes, design D20). Los
// rechazos antes de reservar son `409` con el código y el mensaje del primer problema; un recurso de
// otra empresa es `404` igual que uno inexistente.
import type { DebitNoteIssue } from "@facturador/contracts";
import { AppError, ConflictError, NotFoundError } from "../../../platform/http/errors.ts";

export const draftNotFound = () =>
  new NotFoundError("DEBIT_NOTE_DRAFT_NOT_FOUND", "El borrador de nota de débito no existe.");

export const debitNoteNotFound = () =>
  new NotFoundError("DEBIT_NOTE_NOT_FOUND", "La nota de débito no existe.");

export const invoiceNotFound = () =>
  new NotFoundError("DEBIT_NOTE_INVOICE_NOT_FOUND", "La factura no existe.");

export const draftChanged = () =>
  new ConflictError(
    "DEBIT_NOTE_DRAFT_CHANGED",
    "Otro usuario cambió este borrador después de que lo abriste. Recarga para ver sus datos.",
  );

export class DraftAlreadyEmittedError extends ConflictError {
  readonly debitNoteId: string | null;
  constructor(debitNoteId: string | null) {
    super(
      "DEBIT_NOTE_DRAFT_ALREADY_EMITTED",
      "Este borrador ya se emitió como nota de débito; no se puede cambiar ni emitir otra vez.",
    );
    this.debitNoteId = debitNoteId;
  }
}

/** Referencia del borrador que no existe en la empresa (`400`). */
export const invalidReference = (code: "EMISSION_POINT_NOT_FOUND", message: string) =>
  new AppError(code, 400, message);

/** Rechazo antes de reservar: el primer problema de la evaluación (design D4). */
export class DebitNoteRejectedError extends ConflictError {
  readonly issue: DebitNoteIssue;
  constructor(issue: DebitNoteIssue) {
    super(issue.code, issue.message);
    this.issue = issue;
  }
}

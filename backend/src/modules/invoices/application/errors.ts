// Errores de borradores y facturas con código estable para la API (add-invoice-emission, design
// D2, D6, D8 y D13). Los rechazos de la emisión antes de reservar son `409` con el código y el
// mensaje del primer problema de la evaluación.
import type { InvoiceIssue } from "@facturador/contracts";
import { AppError, ConflictError, NotFoundError } from "../../../platform/http/errors.ts";

export const draftNotFound = () =>
  new NotFoundError("INVOICE_DRAFT_NOT_FOUND", "El borrador no existe.");

export const invoiceNotFound = () =>
  new NotFoundError("INVOICE_NOT_FOUND", "La factura no existe.");

export const draftChanged = () =>
  new ConflictError(
    "INVOICE_DRAFT_CHANGED",
    "Otro usuario cambió este borrador después de que lo abriste. Recarga para ver sus datos.",
  );

export class DraftAlreadyEmittedError extends ConflictError {
  readonly invoiceId: string | null;
  constructor(invoiceId: string | null) {
    super(
      "INVOICE_DRAFT_ALREADY_EMITTED",
      invoiceId
        ? `Este borrador ya se emitió como la factura ${invoiceId}; no se puede cambiar ni emitir otra vez.`
        : "Este borrador ya se emitió; no se puede cambiar ni emitir otra vez.",
    );
    this.invoiceId = invoiceId;
  }
}

export const tooManyLines = (max: number) =>
  new AppError(
    "INVOICE_TOO_MANY_LINES",
    400,
    `El borrador admite como máximo ${max} líneas. Es un límite de la aplicación, no del SRI.`,
  );

/** Referencia del borrador que no existe en la empresa (`400`), con la línea o el pago. */
export const referenceNotFound = (
  code:
    | "EMISSION_POINT_NOT_FOUND"
    | "BUYER_NOT_FOUND"
    | "PRODUCT_NOT_FOUND"
    | "PAYMENT_METHOD_NOT_FOUND",
  message: string,
) => new AppError(code, 400, message);

/** Rechazo de la emisión antes de reservar: el primer problema de la evaluación (design D6). */
export class EmissionRejectedError extends ConflictError {
  readonly issue: InvoiceIssue;
  constructor(issue: InvoiceIssue) {
    super(issue.code, issue.message);
    this.issue = issue;
  }
}

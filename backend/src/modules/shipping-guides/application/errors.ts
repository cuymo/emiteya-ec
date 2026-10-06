// Errores de las guías de remisión con código estable para la API (add-shipping-guides, design D22).
// Los rechazos antes de reservar son `409` con el código y el mensaje del primer problema; un recurso
// de otra empresa es `404` igual que uno inexistente.
import type { ShippingGuideIssue } from "@facturador/contracts";
import { AppError, ConflictError, NotFoundError } from "../../../platform/http/errors.ts";

export const draftNotFound = () =>
  new NotFoundError("SHIPPING_GUIDE_DRAFT_NOT_FOUND", "El borrador de guía de remisión no existe.");

export const shippingGuideNotFound = () =>
  new NotFoundError("SHIPPING_GUIDE_NOT_FOUND", "La guía de remisión no existe.");

export const invoiceNotFound = () =>
  new NotFoundError("SHIPPING_GUIDE_INVOICE_NOT_FOUND", "La factura no existe en tu empresa.");

export const draftChanged = () =>
  new ConflictError(
    "SHIPPING_GUIDE_DRAFT_CHANGED",
    "Otro usuario cambió este borrador después de que lo abriste. Recarga para ver sus datos.",
  );

export class DraftAlreadyEmittedError extends ConflictError {
  readonly shippingGuideId: string | null;
  constructor(shippingGuideId: string | null) {
    super(
      "SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED",
      "Este borrador ya se emitió como guía de remisión; no se puede cambiar ni emitir otra vez.",
    );
    this.shippingGuideId = shippingGuideId;
  }
}

/** Una referencia del borrador que no existe en la empresa: `404`, igual que inexistente. */
export const referenceNotFound = (
  code:
    | "SHIPPING_GUIDE_CARRIER_NOT_FOUND"
    | "SHIPPING_GUIDE_RECIPIENT_NOT_FOUND"
    | "SHIPPING_GUIDE_ESTABLISHMENT_NOT_FOUND"
    | "SHIPPING_GUIDE_PRODUCT_NOT_FOUND"
    | "SHIPPING_GUIDE_INVOICE_NOT_FOUND",
  message: string,
) => new NotFoundError(code, message);

/** El punto de emisión del borrador no existe en la empresa (`400`), como en los demás tipos. */
export const invalidReference = (code: "EMISSION_POINT_NOT_FOUND", message: string) =>
  new AppError(code, 400, message);

/** Rechazo antes de reservar, o un borrador fuera de los límites: el primer problema (design D13). */
export class ShippingGuideRejectedError extends ConflictError {
  readonly issue: ShippingGuideIssue;
  constructor(issue: ShippingGuideIssue) {
    super(issue.code, issue.message);
    this.issue = issue;
  }
}

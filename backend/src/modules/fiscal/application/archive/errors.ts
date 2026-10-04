// Errores de la bandeja y sus documentos con código estable para la API (add-document-archive,
// design D5 y D8). Un comprobante de otra empresa es `404`, igual que uno inexistente.
import { AppError, ConflictError, NotFoundError } from "../../../../platform/http/errors.ts";

export const documentNotFound = () =>
  new NotFoundError("DOCUMENT_NOT_FOUND", "El comprobante no existe.");

export const documentNotAvailable = () =>
  new NotFoundError(
    "DOCUMENT_NOT_AVAILABLE",
    "Ese documento no está disponible para este comprobante.",
  );

/** Los bytes guardados no coinciden con su hash o su tamaño: no se sirve nada. */
export const artifactIntegrityFailed = () =>
  new AppError(
    "ARTIFACT_INTEGRITY_FAILED",
    500,
    "El documento guardado no pasó la verificación de integridad y no se entregó. Avisa al administrador.",
  );

export const rideAlreadyAvailable = () =>
  new ConflictError("RIDE_ALREADY_AVAILABLE", "El RIDE de este comprobante ya está disponible.");

export const rideGenerationInProgress = () =>
  new ConflictError(
    "RIDE_GENERATION_IN_PROGRESS",
    "El RIDE de este comprobante ya se está preparando.",
  );

export const documentNotAuthorized = () =>
  new ConflictError("DOCUMENT_NOT_AUTHORIZED", "Solo un comprobante autorizado tiene RIDE.");

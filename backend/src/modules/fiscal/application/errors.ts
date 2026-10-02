// Errores de negocio de la numeración fiscal, con código estable para la API (design D4, D6 y D9).
import { DOCUMENT_TYPE_LABELS } from "@facturador/contracts";
import { ConflictError, NotFoundError } from "../../../platform/http/errors.ts";
import type { DocumentType } from "../domain/numbering.ts";

const ENVIRONMENT_LABELS = { TEST: "Pruebas", PRODUCTION: "Producción" } as const;

export const emissionPointNotFound = () =>
  new NotFoundError("EMISSION_POINT_NOT_FOUND", "El punto de emisión no existe.");

export const emissionPointUnavailable = () =>
  new ConflictError(
    "EMISSION_POINT_UNAVAILABLE",
    "El punto de emisión no está disponible: él o su establecimiento están inactivos.",
  );

export const sequenceExhausted = (
  documentType: DocumentType,
  point: string,
  environment: keyof typeof ENVIRONMENT_LABELS,
) =>
  new ConflictError(
    "SEQUENCE_EXHAUSTED",
    `Se agotó la numeración de ${DOCUMENT_TYPE_LABELS[documentType].toLowerCase()} en el punto ${point} (${ENVIRONMENT_LABELS[environment]}). Crea otro punto de emisión para seguir emitiendo.`,
  );

export const sequenceChanged = () =>
  new ConflictError(
    "SEQUENCE_CHANGED",
    "El secuencial cambió mientras lo editabas. Recarga para ver el valor vigente.",
  );

export const sequenceNumberReserved = (lastReserved: number) =>
  new ConflictError(
    "SEQUENCE_NUMBER_RESERVED",
    `El último secuencial reservado es ${lastReserved}; el siguiente debe ser mayor.`,
  );

// Errores de terceros con código estable para la API (add-parties-and-products, design D11).
import { AppError, ConflictError, NotFoundError } from "../../../platform/http/errors.ts";

export const partyNotFound = () => new NotFoundError("PARTY_NOT_FOUND", "El tercero no existe.");

export const partyChanged = () =>
  new ConflictError(
    "PARTY_CHANGED",
    "Otro usuario cambió este tercero después de que lo abriste. Recarga para ver sus datos.",
  );

export const partySystemRecord = () =>
  new ConflictError(
    "PARTY_SYSTEM_RECORD",
    "El consumidor final es un registro del sistema: no se corrige ni se desactiva.",
  );

export const identificationTaken = (legalName: string, inactive: boolean) =>
  new ConflictError(
    "PARTY_IDENTIFICATION_TAKEN",
    inactive
      ? `Ya existe un tercero desactivado con esa identificación: ${legalName}. Reactívalo en lugar de registrarlo otra vez.`
      : `Ya existe un tercero con esa identificación: ${legalName}.`,
  );

export const identificationReserved = () =>
  new AppError(
    "PARTY_IDENTIFICATION_RESERVED",
    400,
    "La venta a consumidor final está reservada al consumidor final del sistema.",
  );

export const identificationTypeUnavailable = () =>
  new AppError(
    "PARTY_IDENTIFICATION_TYPE_UNAVAILABLE",
    400,
    "El tipo de identificación no está vigente en el catálogo fiscal.",
  );

export const identificationInvalid = (label: string, description: string) =>
  new AppError(
    "PARTY_IDENTIFICATION_INVALID",
    400,
    `La identificación no cumple la regla de ${label}: ${description}.`,
  );

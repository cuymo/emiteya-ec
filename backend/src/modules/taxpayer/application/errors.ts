// Errores de negocio del módulo taxpayer, con código estable para la API (design D12).
import { AppError, ConflictError, NotFoundError } from "../../../platform/http/errors.ts";
import { LOGO_MAX_DIMENSION, formatKilobytes, type LogoInspection } from "../domain/logo.ts";

export const configVersionConflict = () =>
  new ConflictError(
    "CONFIG_VERSION_CONFLICT",
    "Otro administrador cambió los datos. Recarga para ver la versión vigente.",
  );

export const taxIdentityLocked = () =>
  new ConflictError(
    "TAX_IDENTITY_LOCKED",
    "El RUC ya no puede cambiar en esta empresa. Para emitir con otro RUC se necesita otra empresa.",
  );

export const taxpayerNotConfigured = () =>
  new ConflictError("TAXPAYER_NOT_CONFIGURED", "Registra primero los datos de la empresa.");

const LOGO_REJECTIONS: Record<Exclude<LogoInspection, { ok: true }>["reason"], string> = {
  UNSUPPORTED_FORMAT: "El logo debe ser una imagen PNG o JPEG.",
  UNREADABLE: "No se pudo leer la imagen del logo. Revisa que el archivo no esté dañado.",
  DIMENSIONS_TOO_LARGE: `El logo debe medir como máximo ${LOGO_MAX_DIMENSION} px por lado.`,
};

export const invalidLogo = (reason: keyof typeof LOGO_REJECTIONS) =>
  new AppError("INVALID_LOGO", 400, LOGO_REJECTIONS[reason]);

export const logoTooLarge = (maxBytes: number) =>
  new AppError("LOGO_TOO_LARGE", 413, `El logo supera el límite de ${formatKilobytes(maxBytes)}.`);

export const logoNotFound = () => new NotFoundError("LOGO_NOT_FOUND", "La empresa no tiene logo.");

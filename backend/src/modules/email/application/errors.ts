// Errores del correo con código estable para la API (add-email-delivery, design D10). Ningún mensaje
// incluye la contraseña ni la respuesta técnica completa del servidor de correo.
import { AppError, ConflictError } from "../../../platform/http/errors.ts";

export const emailSettingsChanged = () =>
  new ConflictError(
    "EMAIL_SETTINGS_CHANGED",
    "Otro usuario cambió la configuración del correo después de que la abriste. Recarga para ver sus datos.",
  );

export const emailPasswordRequired = () =>
  new AppError(
    "EMAIL_PASSWORD_REQUIRED",
    400,
    "Escribe la contraseña del usuario del servidor de correo.",
  );

export const emailUsernameRequired = () =>
  new AppError(
    "EMAIL_USERNAME_REQUIRED",
    400,
    "La contraseña necesita el usuario del servidor de correo.",
  );

export const emailPlaintextNotAllowed = () =>
  new AppError(
    "EMAIL_PLAINTEXT_NOT_ALLOWED",
    400,
    "Este despliegue exige una conexión cifrada: elige TLS directo o STARTTLS.",
  );

export const emailCustodyDisabled = () =>
  new ConflictError(
    "EMAIL_CUSTODY_DISABLED",
    "Esta instalación no tiene custodia de secretos, así que no puede guardar la contraseña del servidor de correo.",
  );

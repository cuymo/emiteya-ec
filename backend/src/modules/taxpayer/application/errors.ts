// Errores de negocio del módulo taxpayer, con código estable para la API (design D12).
import { ConflictError } from "../../../platform/http/errors.ts";

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

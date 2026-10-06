// Errores de los catálogos fiscales con código estable para la API (add-fiscal-catalogs, design D9
// y D11).
import { AppError, NotFoundError } from "../../../platform/http/errors.ts";

export const catalogNotFound = () =>
  new NotFoundError("FISCAL_CATALOG_NOT_FOUND", "El catálogo fiscal no existe.");

export const entryNotFound = () =>
  new NotFoundError("FISCAL_CATALOG_ENTRY_NOT_FOUND", "La entrada no existe en el catálogo.");

export const notEnableable = () =>
  new AppError(
    "FISCAL_CATALOG_NOT_ENABLEABLE",
    400,
    "Este catálogo no admite habilitación por empresa: todas sus entradas oficiales están disponibles.",
  );

/** Entrada fuera de alcance del MVP: su habilitación no tendría efecto (add-withholding-receipts, D11). */
export const entryNotSelectable = () =>
  new AppError(
    "CATALOG_ENTRY_NOT_SELECTABLE",
    400,
    "Esta entrada está fuera del alcance del sistema: no se puede elegir, así que su habilitación no cambia.",
  );

export const entryNotInForce = () =>
  new AppError(
    "FISCAL_CATALOG_ENTRY_NOT_IN_FORCE",
    400,
    "Esta entrada no tiene una versión vigente ni futura: no se puede habilitar.",
  );

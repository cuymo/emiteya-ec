// Errores del inventario con código estable para la API (add-minimal-inventory, design D7).
import { ConflictError, NotFoundError } from "../../../platform/http/errors.ts";

export const productNotFound = () =>
  new NotFoundError("PRODUCT_NOT_FOUND", "El producto no existe.");

export const inventoryAlreadyInitialized = () =>
  new ConflictError(
    "INVENTORY_ALREADY_INITIALIZED",
    "El inventario de este producto ya está inicializado: su saldo cambia solo con movimientos.",
  );

export const inventoryNotInitialized = () =>
  new ConflictError(
    "INVENTORY_NOT_INITIALIZED",
    "El inventario de este producto todavía no está inicializado.",
  );

export const stockTrackingRequired = () =>
  new ConflictError(
    "STOCK_TRACKING_REQUIRED",
    "Solo un bien marcado como controlado en stock tiene inventario: márcalo primero en Productos.",
  );

export const stockTrackingDisabled = () =>
  new ConflictError(
    "STOCK_TRACKING_DISABLED",
    "El control de stock de este producto está desactivado: un administrador debe reactivarlo para registrar movimientos.",
  );

export const stockTrackingHasBalance = (balance: string) =>
  new ConflictError(
    "STOCK_TRACKING_HAS_BALANCE",
    `El control de stock solo se desactiva con saldo cero, y este producto tiene ${balance}.`,
  );

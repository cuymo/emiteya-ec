// Errores de productos con código estable para la API (add-parties-and-products, design D11).
import { AppError, ConflictError, NotFoundError } from "../../../platform/http/errors.ts";

export const productNotFound = () =>
  new NotFoundError("PRODUCT_NOT_FOUND", "El producto no existe.");

export const productChanged = () =>
  new ConflictError(
    "PRODUCT_CHANGED",
    "Otro usuario cambió este producto después de que lo abriste. Recarga para ver sus datos.",
  );

/** La marca de un producto con inventario inicializado la cambia el inventario (add-minimal-inventory). */
export const stockTrackingManagedByInventory = () =>
  new ConflictError(
    "STOCK_TRACKING_MANAGED_BY_INVENTORY",
    "El inventario de este producto ya está inicializado: un administrador cambia su control de stock desde Inventario.",
  );

export const mainCodeTaken = (mainCode: string) =>
  new ConflictError(
    "PRODUCT_MAIN_CODE_TAKEN",
    `El código principal ${mainCode} ya está en uso en otro producto de tu empresa.`,
  );

const SLOT_LABELS = {
  iva: "La tarifa de IVA",
  ice: "El código de ICE",
  irbpnr: "El código de IRBPNR",
};
const REASONS = {
  NOT_FOUND: "no existe en el catálogo fiscal",
  NOT_IN_FORCE: "no tiene una versión vigente hoy",
  DISABLED: "no está habilitada para tu empresa",
};

export const taxUnavailable = (
  slot: keyof typeof SLOT_LABELS,
  entryKey: string,
  reason: keyof typeof REASONS,
) =>
  new AppError(
    "PRODUCT_TAX_UNAVAILABLE",
    400,
    `${SLOT_LABELS[slot]} ${entryKey} ${REASONS[reason]}.`,
  );

/** Un servicio no lleva IRBPNR ni control de stock; el mensaje dice qué quitar (design D6). */
export const goodsOnly = (violations: readonly ("irbpnr" | "stockTracked")[]) => {
  const what = violations.map((v) => (v === "irbpnr" ? "el IRBPNR" : "el control de stock"));
  return new AppError(
    "PRODUCT_GOODS_ONLY",
    400,
    `Un servicio no lleva ${what.join(" ni ")}: ${violations.length > 1 ? "quítalos" : "quítalo"} para guardarlo como servicio.`,
  );
};

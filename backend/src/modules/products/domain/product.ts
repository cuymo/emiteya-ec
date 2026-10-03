// Producto o servicio de una empresa (add-parties-and-products, design D6, D7, D9 y D13): reglas
// puras del tipo, sus referencias fiscales, sus claves de búsqueda y los cambios que se auditan.
import {
  PRODUCT_TAX_SLOTS,
  type ProductData,
  type ProductKind,
  type ProductTaxSlot,
  type ProductTaxes,
  type RecordStatus,
} from "@facturador/contracts";
import { UnitPrice } from "../../../platform/decimal/fiscal-decimal.ts";
import { searchKey } from "../../../platform/search/search-key.ts";

export type ProductRecord = {
  id: string;
  companyId: string;
  kind: ProductKind;
  mainCode: string | null;
  auxiliaryCode: string | null;
  name: string;
  description: string | null;
  /** Forma canónica más corta del precio sin impuestos. */
  unitPrice: string;
  stockTracked: boolean;
  status: RecordStatus;
  version: number;
  taxes: ProductTaxes;
  createdAt: Date;
  updatedAt: Date;
};

export type TaxReference = { slot: ProductTaxSlot; catalogType: string; entryKey: string };

/** Referencias del producto, en el orden de sus posiciones. */
export function taxReferences(taxes: ProductTaxes): TaxReference[] {
  return (Object.keys(PRODUCT_TAX_SLOTS) as ProductTaxSlot[]).flatMap((slot) => {
    const entryKey = taxes[slot];
    return entryKey ? [{ slot, catalogType: PRODUCT_TAX_SLOTS[slot], entryKey }] : [];
  });
}

/**
 * Lo que un servicio no puede llevar, evaluado sobre el estado final de la solicitud (design D6):
 * pasar a servicio exige quitar en la misma solicitud el IRBPNR y el control de stock.
 */
export function goodsOnlyViolations(data: Pick<ProductData, "kind" | "stockTracked" | "taxes">) {
  if (data.kind === "GOOD") return [];
  const violations: ("irbpnr" | "stockTracked")[] = [];
  if (data.taxes.irbpnr !== null) violations.push("irbpnr");
  if (data.stockTracked) violations.push("stockTracked");
  return violations;
}

export function productSearchKeys(data: Pick<ProductData, "name" | "mainCode" | "auxiliaryCode">) {
  return {
    searchName: searchKey(data.name),
    searchMainCode: data.mainCode === null ? null : searchKey(data.mainCode),
    searchAuxiliaryCode: data.auxiliaryCode === null ? null : searchKey(data.auxiliaryCode),
  };
}

/** Precio exacto: canónico para la API, con la escala de la columna para la base de datos. */
export const canonicalPrice = (text: string) => UnitPrice.parse(text).toString();

/**
 * Cambios auditables de una corrección (design D13): solo el precio y los impuestos, con su valor
 * anterior y el nuevo. null si no cambian.
 */
export function productChanges(
  before: ProductRecord,
  after: ProductData,
): Record<string, string | null> | null {
  const changes: Record<string, string | null> = {};
  const price = canonicalPrice(after.unitPrice);
  if (before.unitPrice !== price) {
    changes["unitPrice.from"] = before.unitPrice;
    changes["unitPrice.to"] = price;
  }
  for (const slot of Object.keys(PRODUCT_TAX_SLOTS) as ProductTaxSlot[]) {
    if (before.taxes[slot] !== after.taxes[slot]) {
      changes[`taxes.${slot}.from`] = before.taxes[slot];
      changes[`taxes.${slot}.to`] = after.taxes[slot];
    }
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/** true si la corrección cambia algún dato del producto, auditable o no. */
export function productDiffers(before: ProductRecord, after: ProductData): boolean {
  return (
    productChanges(before, after) !== null ||
    before.kind !== after.kind ||
    before.mainCode !== after.mainCode ||
    before.auxiliaryCode !== after.auxiliaryCode ||
    before.name !== after.name ||
    before.description !== after.description ||
    before.stockTracked !== after.stockTracked
  );
}

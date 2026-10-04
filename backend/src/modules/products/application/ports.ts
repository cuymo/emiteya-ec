// Puertos del módulo de productos (add-parties-and-products, design D6 a D8, D10 y D14).
import type {
  CatalogRateView,
  ListProductsQuery,
  ProductData,
  RecordStatus,
} from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { ProductRecord } from "../domain/product.ts";

/** Versión de una entrada tal como la publica `catalogs` (design D2). */
type CatalogVersion = {
  officialLabel: string;
  taxKind: CatalogRateView["taxKind"] | null;
  sriTaxCode: string | null;
  rateKind: CatalogRateView["rateKind"] | null;
  percentage: string | null;
};

/** Disponibilidad de una entrada para la empresa en la fecha, sin sesión (design D2). */
export type EntryAvailability = {
  code: string;
  applicable: CatalogVersion | null;
  latest: CatalogVersion;
  withdrawn: boolean;
  usable: boolean;
  calculationData: "COMPLETE" | "MISSING";
};

export type CatalogAvailability = {
  availability(
    companyId: string,
    catalogType: "iva-rate" | "ice-rate" | "irbpnr-rate",
    date: string,
  ): Promise<Map<string, EntryAvailability>>;
};

/** Claves de entradas por catálogo, para filtrar por estado tributario sin SQL cruzado (D8). */
export type EntryKeySet = readonly { catalogType: string; entryKey: string }[];

export type TaxStatusFilter = { review: EntryKeySet; incomplete: EntryKeySet };

export interface ProductRepository {
  find(companyId: string, productId: string): Promise<ProductRecord | null>;
  search(
    companyId: string,
    query: ListProductsQuery,
    taxStatus: TaxStatusFilter,
  ): Promise<{ items: ProductRecord[]; total: number }>;
  /** Falla con DuplicateMainCodeError si el código principal ya existe en la empresa. */
  create(companyId: string, data: ProductData, userId: string): Promise<ProductRecord>;
  /** Solo si la versión coincide; reemplaza los impuestos. Devuelve si actualizó. */
  updateIfVersion(
    companyId: string,
    productId: string,
    expectedVersion: number,
    data: ProductData,
    userId: string,
  ): Promise<boolean>;
  changeStatusIfDifferent(
    companyId: string,
    productId: string,
    status: RecordStatus,
    userId: string,
  ): Promise<boolean>;
  /**
   * Fija la marca de control de stock si es distinta (add-minimal-inventory, design D7): la usa el
   * inventario para un producto con inventario inicializado. true si cambió.
   */
  setStockTrackedIfDifferent(
    companyId: string,
    productId: string,
    stockTracked: boolean,
    userId: string,
  ): Promise<boolean>;
  /** Productos activos por estado tributario y por entrada referida. */
  taxSummary(
    companyId: string,
    taxStatus: TaxStatusFilter,
  ): Promise<{
    byStatus: { READY: number; REVIEW_REQUIRED: number; INCOMPLETE: number };
    byEntry: { catalogType: string; entryKey: string; activeProducts: number }[];
  }>;
}

/**
 * Inventario de un producto sobre un cliente (add-minimal-inventory, design D7 y D11): si está
 * inicializado, la marca de control de stock la cambia el inventario. Lo implementa `inventory`,
 * que toma el lock del control de stock del producto, y lo inyecta `main.ts`; products no lo importa.
 */
export type InventoryInitialization = (db: DbClient) => {
  isInitialized(companyId: string, productId: string): Promise<boolean>;
};

export type ProductsScope = {
  products: ProductRepository;
  audit: AuditLog;
  inventory: ReturnType<InventoryInitialization>;
};

export interface ProductsUnitOfWork {
  run<T>(work: (scope: ProductsScope) => Promise<T>): Promise<T>;
}

export class DuplicateMainCodeError extends Error {
  constructor() {
    super("El código principal ya existe en la empresa.");
    this.name = "DuplicateMainCodeError";
  }
}

// Repositorio de productos sobre PostgreSQL (add-parties-and-products, design D6 a D10 y D14). Toda
// consulta filtra por la empresa. El precio se convierte por texto con la escala de su columna. El
// filtro por estado tributario usa las claves que publica `catalogs`, nunca sus tablas.
import type { ProductKind, ProductTaxes, RecordStatus } from "@facturador/contracts";
import type { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { UnitPrice } from "../../../platform/decimal/fiscal-decimal.ts";
import { escapeLike, searchKey } from "../../../platform/search/search-key.ts";
import {
  DuplicateMainCodeError,
  type EntryKeySet,
  type ProductRepository,
} from "../application/ports.ts";
import { productSearchKeys, taxReferences, type ProductRecord } from "../domain/product.ts";

const WITH_TAXES = { taxes: { select: { catalogType: true, entryKey: true } } } as const;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof WITH_TAXES }>;

const SLOT_BY_CATALOG: Record<string, keyof ProductTaxes> = {
  "iva-rate": "iva",
  "ice-rate": "ice",
  "irbpnr-rate": "irbpnr",
};

function toRecord(row: ProductRow): ProductRecord {
  const taxes: ProductTaxes = { iva: "", ice: null, irbpnr: null };
  for (const tax of row.taxes) taxes[SLOT_BY_CATALOG[tax.catalogType]!] = tax.entryKey;
  return {
    id: row.id,
    companyId: row.companyId,
    kind: row.kind as ProductKind,
    mainCode: row.mainCode,
    auxiliaryCode: row.auxiliaryCode,
    name: row.name,
    description: row.description,
    unitPrice: UnitPrice.fromDatabase(row.unitPrice).toString(),
    stockTracked: row.stockTracked,
    status: row.status as RecordStatus,
    version: row.version,
    taxes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "23505";
}

async function translateUnique<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateMainCodeError();
    throw error;
  }
}

/** Productos con alguna referencia en el conjunto de claves. */
const referencesAny = (keys: EntryKeySet): Prisma.ProductTaxListRelationFilter => ({
  some: { OR: keys.map(({ catalogType, entryKey }) => ({ catalogType, entryKey })) },
});

/** Filtro por estado tributario derivado (design D8). */
function taxStatusWhere(
  status: "READY" | "REVIEW_REQUIRED" | "INCOMPLETE",
  sets: { review: EntryKeySet; incomplete: EntryKeySet },
): Prisma.ProductWhereInput {
  const inReview: Prisma.ProductWhereInput =
    sets.review.length > 0 ? { taxes: referencesAny(sets.review) } : { id: { in: [] } };
  const notInReview: Prisma.ProductWhereInput =
    sets.review.length > 0 ? { NOT: { taxes: referencesAny(sets.review) } } : {};
  const inIncomplete: Prisma.ProductWhereInput =
    sets.incomplete.length > 0 ? { taxes: referencesAny(sets.incomplete) } : { id: { in: [] } };
  const notInIncomplete: Prisma.ProductWhereInput =
    sets.incomplete.length > 0 ? { NOT: { taxes: referencesAny(sets.incomplete) } } : {};
  if (status === "REVIEW_REQUIRED") return inReview;
  if (status === "INCOMPLETE") return { AND: [notInReview, inIncomplete] };
  return { AND: [notInReview, notInIncomplete] };
}

function columns(data: Parameters<ProductRepository["create"]>[1]) {
  return {
    kind: data.kind,
    mainCode: data.mainCode,
    auxiliaryCode: data.auxiliaryCode,
    name: data.name,
    description: data.description,
    unitPrice: UnitPrice.parse(data.unitPrice).toDatabase(),
    stockTracked: data.stockTracked,
    ...productSearchKeys(data),
  };
}

export function createProductRepository(db: DbClient): ProductRepository {
  return {
    async find(companyId, productId) {
      const row = await db.product.findFirst({
        where: { id: productId, companyId },
        include: WITH_TAXES,
      });
      return row ? toRecord(row) : null;
    },

    async search(companyId, query, sets) {
      const key = query.search ? escapeLike(searchKey(query.search)) : "";
      const where: Prisma.ProductWhereInput = {
        companyId,
        ...(query.status === "ALL" ? {} : { status: query.status }),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(key
          ? {
              OR: [
                { searchMainCode: { startsWith: key } },
                { searchAuxiliaryCode: { startsWith: key } },
                { searchName: { contains: key } },
              ],
            }
          : {}),
        ...(query.taxStatus ? { AND: [taxStatusWhere(query.taxStatus, sets)] } : {}),
      };
      // Orden estable: la clave elegida y, como desempate, el identificador.
      const orderBy: Prisma.ProductOrderByWithRelationInput[] =
        query.sort === "mainCode"
          ? [{ mainCode: { sort: query.direction, nulls: "last" } }, { id: "asc" }]
          : [{ searchName: query.direction }, { id: "asc" }];
      const [rows, total] = await Promise.all([
        db.product.findMany({
          where,
          orderBy,
          include: WITH_TAXES,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.product.count({ where }),
      ]);
      return { items: rows.map(toRecord), total };
    },

    async searchForStock(companyId, query) {
      const key = query.search ? escapeLike(searchKey(query.search)) : "";
      const tracked: Prisma.ProductWhereInput =
        query.stockTracked === undefined ? {} : { stockTracked: query.stockTracked };
      const where: Prisma.ProductWhereInput = {
        companyId,
        AND: [
          query.orIds ? { OR: [tracked, { id: { in: [...query.orIds] } }] } : tracked,
          ...(query.onlyIds ? [{ id: { in: [...query.onlyIds] } }] : []),
          ...(query.excludeIds ? [{ id: { notIn: [...query.excludeIds] } }] : []),
          ...(key
            ? [
                {
                  OR: [
                    { searchMainCode: { startsWith: key } },
                    { searchAuxiliaryCode: { startsWith: key } },
                    { searchName: { contains: key } },
                  ],
                },
              ]
            : []),
        ],
      };
      const [rows, total] = await Promise.all([
        db.product.findMany({
          where,
          orderBy: [{ searchName: "asc" }, { id: "asc" }],
          include: WITH_TAXES,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.product.count({ where }),
      ]);
      return { items: rows.map(toRecord), total };
    },

    create(companyId, data, userId) {
      return translateUnique(async () => {
        const product = await db.product.create({
          data: { companyId, ...columns(data), createdBy: userId, updatedBy: userId },
        });
        await db.productTax.createMany({
          data: taxReferences(data.taxes).map(({ catalogType, entryKey }) => ({
            productId: product.id,
            companyId,
            catalogType,
            entryKey,
          })),
        });
        return toRecord({ ...product, taxes: taxReferences(data.taxes) });
      });
    },

    updateIfVersion(companyId, productId, expectedVersion, data, userId) {
      return translateUnique(async () => {
        const { count } = await db.product.updateMany({
          where: { id: productId, companyId, version: expectedVersion },
          data: { ...columns(data), version: { increment: 1 }, updatedBy: userId },
        });
        if (count !== 1) return false;
        // Reemplazo de las referencias en la misma transacción; los triggers diferidos comprueban
        // al confirmar el IVA obligatorio y el IRBPNR solo en bienes.
        await db.productTax.deleteMany({ where: { productId, companyId } });
        await db.productTax.createMany({
          data: taxReferences(data.taxes).map(({ catalogType, entryKey }) => ({
            productId,
            companyId,
            catalogType,
            entryKey,
          })),
        });
        return true;
      });
    },

    async setStockTrackedIfDifferent(companyId, productId, stockTracked, userId) {
      const { count } = await db.product.updateMany({
        where: { id: productId, companyId, stockTracked: { not: stockTracked } },
        data: { stockTracked, version: { increment: 1 }, updatedBy: userId },
      });
      return count === 1;
    },

    async changeStatusIfDifferent(companyId, productId, status, userId) {
      const { count } = await db.product.updateMany({
        where: { id: productId, companyId, status: { not: status } },
        data: { status, version: { increment: 1 }, updatedBy: userId },
      });
      return count === 1;
    },

    async taxSummary(companyId, sets) {
      const active: Prisma.ProductWhereInput = { companyId, status: "ACTIVE" };
      const count = (status: "READY" | "REVIEW_REQUIRED" | "INCOMPLETE") =>
        db.product.count({ where: { AND: [active, taxStatusWhere(status, sets)] } });
      const [READY, REVIEW_REQUIRED, INCOMPLETE, groups] = await Promise.all([
        count("READY"),
        count("REVIEW_REQUIRED"),
        count("INCOMPLETE"),
        db.productTax.groupBy({
          by: ["catalogType", "entryKey"],
          where: { companyId, product: { status: "ACTIVE" } },
          _count: { _all: true },
          orderBy: [{ catalogType: "asc" }, { entryKey: "asc" }],
        }),
      ]);
      return {
        byStatus: { READY, REVIEW_REQUIRED, INCOMPLETE },
        byEntry: groups.map((group) => ({
          catalogType: group.catalogType,
          entryKey: group.entryKey,
          activeProducts: group._count._all,
        })),
      };
    },
  };
}

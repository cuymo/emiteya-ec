// Lista de las liquidaciones de compra de una empresa (add-purchase-settlements, design D21): por
// número o proveedor (la contraparte congelada en el comprobante) y estado, las más recientes primero.
import type { DbClient } from "../../../platform/db/database.ts";
import { toStoredDocument } from "../../fiscal/infrastructure/index.ts";
import type { PurchaseSettlementListReader } from "../application/ports.ts";

export function createPurchaseSettlementListReader(db: DbClient): PurchaseSettlementListReader {
  return {
    async list(companyId, query) {
      const search = query.search?.trim();
      const where = {
        companyId,
        documentType: "03",
        ...(query.state ? { state: query.state } : {}),
        ...(search
          ? {
              OR: [
                { documentNumber: { contains: search } },
                { buyerIdentification: { contains: search } },
                { buyerName: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.electronicDocument.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.electronicDocument.count({ where }),
      ]);
      return { items: rows.map(toStoredDocument), total };
    },
  };
}

// Lista de los comprobantes de retención de una empresa (add-withholding-receipts, design D21 y D28):
// por número o proveedor (el sujeto congelado en el comprobante), estado y período fiscal (el del
// registro del comprobante, con su índice), los más recientes primero.
import type { DbClient } from "../../../platform/db/database.ts";
import { toStoredDocument } from "../../fiscal/infrastructure/index.ts";
import type { WithholdingReceiptListReader } from "../application/ports.ts";

export function createWithholdingReceiptListReader(db: DbClient): WithholdingReceiptListReader {
  return {
    async list(companyId, query) {
      const search = query.search?.trim();
      const where = {
        companyId,
        documentType: "07",
        ...(query.state ? { state: query.state } : {}),
        ...(query.fiscalPeriod
          ? { withholdingReceipt: { is: { fiscalPeriod: query.fiscalPeriod } } }
          : {}),
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

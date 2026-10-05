// Lista de las notas de crédito de una empresa (add-credit-notes, design D16): por número o
// comprador, estado y causa (la de su reserva acreditable), las más recientes primero.
import type { DbClient } from "../../../platform/db/database.ts";
import { toStoredDocument } from "../../fiscal/infrastructure/index.ts";
import type { CreditNoteListReader } from "../application/ports.ts";

export function createCreditNoteListReader(db: DbClient): CreditNoteListReader {
  return {
    async list(companyId, query) {
      const search = query.search?.trim();
      const where = {
        companyId,
        documentType: "04",
        ...(query.state ? { state: query.state } : {}),
        ...(query.cause ? { creditReservation: { is: { cause: query.cause } } } : {}),
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

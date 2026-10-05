// Lista de las notas de débito de una empresa (add-debit-notes, design D20): por número o comprador,
// estado y causa (la de alguno de sus conceptos, en su snapshot), las más recientes primero.
import type { DbClient } from "../../../platform/db/database.ts";
import { toStoredDocument } from "../../fiscal/infrastructure/index.ts";
import type { DebitNoteListReader } from "../application/ports.ts";

export function createDebitNoteListReader(db: DbClient): DebitNoteListReader {
  return {
    async list(companyId, query) {
      const search = query.search?.trim();
      const where = {
        companyId,
        documentType: "05",
        ...(query.state ? { state: query.state } : {}),
        ...(query.cause
          ? { snapshot: { path: ["concepts"], array_contains: [{ cause: query.cause }] } }
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

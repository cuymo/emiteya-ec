// Repositorio de borradores de liquidación de compra sobre Prisma (add-purchase-settlements, design
// D25). Las líneas y los pagos se guardan como los arreglos JSON que validó el contrato: un borrador
// es un documento de trabajo, no fiscal, y la verdad de la liquidación es su snapshot. Los decimales
// viajan como texto exacto y nunca pasan por `number`.
import type { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { PurchaseSettlementDraftRepository } from "../application/ports.ts";
import type {
  DraftLine,
  DraftPayment,
  PurchaseSettlementDraftContent,
  PurchaseSettlementDraftRecord,
  PurchaseSettlementDraftStatus,
} from "../domain/draft.ts";

type Row = Prisma.PurchaseSettlementDraftGetPayload<object>;

const toRecord = (row: Row): PurchaseSettlementDraftRecord => ({
  id: row.id,
  companyId: row.companyId,
  emissionPointId: row.emissionPointId,
  supplierPartyId: row.supplierPartyId,
  supplierAddress: row.supplierAddress,
  lines: row.lines as unknown as DraftLine[],
  payments: row.payments as unknown as DraftPayment[],
  status: row.status as PurchaseSettlementDraftStatus,
  documentId: row.documentId,
  version: row.version,
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedBy,
});

const columns = (content: PurchaseSettlementDraftContent) => ({
  emissionPointId: content.emissionPointId,
  supplierPartyId: content.supplierPartyId,
  supplierAddress: content.supplierAddress,
  lines: content.lines as unknown as Prisma.InputJsonValue,
  payments: content.payments as unknown as Prisma.InputJsonValue,
});

export function createPurchaseSettlementDraftRepository(
  db: DbClient,
): PurchaseSettlementDraftRepository {
  const find = async (companyId: string, draftId: string) => {
    const row = await db.purchaseSettlementDraft.findFirst({ where: { id: draftId, companyId } });
    return row ? toRecord(row) : null;
  };

  return {
    async create(companyId, content, userId) {
      const row = await db.purchaseSettlementDraft.create({
        data: { companyId, ...columns(content), createdBy: userId, updatedBy: userId },
      });
      return toRecord(row);
    },

    find,

    async list(companyId, { page, pageSize }) {
      const where = { companyId, status: "DRAFT" };
      const [rows, total] = await Promise.all([
        db.purchaseSettlementDraft.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.purchaseSettlementDraft.count({ where }),
      ]);
      return { items: rows.map(toRecord), total };
    },

    async updateIfVersion(companyId, draftId, expectedVersion, content, userId) {
      const { count } = await db.purchaseSettlementDraft.updateMany({
        where: { id: draftId, companyId, status: "DRAFT", version: expectedVersion },
        data: {
          ...columns(content),
          version: { increment: 1 },
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });
      return count > 0;
    },

    async deleteIfDraft(companyId, draftId) {
      const { count } = await db.purchaseSettlementDraft.deleteMany({
        where: { id: draftId, companyId, status: "DRAFT" },
      });
      return count > 0;
    },
  };
}

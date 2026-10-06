// Repositorio de borradores de comprobante de retención sobre Prisma (add-withholding-receipts,
// design D28). Los documentos sustento, con sus impuestos, pagos y retenciones, se guardan como el
// arreglo JSON que validó el contrato: un borrador es un documento de trabajo, no fiscal, y la verdad
// del comprobante es su snapshot. Los importes viajan como texto exacto y nunca pasan por `number`.
import type { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { WithholdingDraftRepository } from "../application/ports.ts";
import type {
  DraftSupport,
  WithholdingDraftContent,
  WithholdingDraftRecord,
  WithholdingDraftStatus,
} from "../domain/draft.ts";

type Row = Prisma.WithholdingReceiptDraftGetPayload<object>;

const toRecord = (row: Row): WithholdingDraftRecord => ({
  id: row.id,
  companyId: row.companyId,
  partyId: row.partyId,
  relatedParty: row.relatedParty as WithholdingDraftRecord["relatedParty"],
  fiscalPeriod: row.fiscalPeriod,
  emissionPointId: row.emissionPointId,
  supports: row.supports as unknown as DraftSupport[],
  status: row.status as WithholdingDraftStatus,
  documentId: row.documentId,
  version: row.version,
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedBy,
});

const columns = (content: WithholdingDraftContent) => ({
  partyId: content.partyId,
  relatedParty: content.relatedParty,
  fiscalPeriod: content.fiscalPeriod,
  emissionPointId: content.emissionPointId,
  supports: content.supports as unknown as Prisma.InputJsonValue,
});

export function createWithholdingDraftRepository(db: DbClient): WithholdingDraftRepository {
  const find = async (companyId: string, draftId: string) => {
    const row = await db.withholdingReceiptDraft.findFirst({ where: { id: draftId, companyId } });
    return row ? toRecord(row) : null;
  };

  return {
    async create(companyId, content, userId) {
      const row = await db.withholdingReceiptDraft.create({
        data: { companyId, ...columns(content), createdBy: userId, updatedBy: userId },
      });
      return toRecord(row);
    },

    find,

    async list(companyId, { page, pageSize }) {
      const where = { companyId, status: "DRAFT" };
      const [rows, total] = await Promise.all([
        db.withholdingReceiptDraft.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.withholdingReceiptDraft.count({ where }),
      ]);
      return { items: rows.map(toRecord), total };
    },

    async updateIfVersion(companyId, draftId, expectedVersion, content, userId) {
      const { count } = await db.withholdingReceiptDraft.updateMany({
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
      const { count } = await db.withholdingReceiptDraft.deleteMany({
        where: { id: draftId, companyId, status: "DRAFT" },
      });
      return count > 0;
    },
  };
}

// Repositorio de borradores sobre Prisma (add-invoice-emission, design D2). Los importes viajan como
// texto canónico y nunca pasan por `number`. Las escrituras de líneas y pagos van en la transacción
// de la unidad de trabajo, con el borrador.
import type { DbClient } from "../../../platform/db/database.ts";
import { FiscalDecimal } from "../../../platform/decimal/fiscal-decimal.ts";
import type { DraftRepository } from "../application/ports.ts";
import type { DraftContent, DraftRecord, DraftStatus } from "../domain/draft.ts";

const INCLUDE = {
  lines: { orderBy: { position: "asc" as const } },
  payments: { orderBy: { position: "asc" as const } },
};

type Row = {
  id: string;
  companyId: string;
  status: string;
  documentId: string | null;
  version: number;
  emissionPointId: string | null;
  buyerPartyId: string | null;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  lines: {
    position: number;
    productId: string;
    quantity: { toFixed(): string };
    discount: { toFixed(): string };
  }[];
  payments: { position: number; entryKey: string; amount: { toFixed(): string } | null }[];
};

const toRecord = (row: Row): DraftRecord => ({
  id: row.id,
  companyId: row.companyId,
  status: row.status as DraftStatus,
  documentId: row.documentId,
  version: row.version,
  emissionPointId: row.emissionPointId,
  buyerPartyId: row.buyerPartyId,
  lines: row.lines.map((line) => ({
    position: line.position,
    productId: line.productId,
    quantity: FiscalDecimal.fromDatabase("cantidad", line.quantity).toString(),
    discount: FiscalDecimal.fromDatabase("importe", line.discount).toString(),
  })),
  payments: row.payments.map((payment) => ({
    position: payment.position,
    paymentMethod: payment.entryKey,
    amount: payment.amount
      ? FiscalDecimal.fromDatabase("importe", payment.amount).toString()
      : null,
  })),
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedBy,
});

export function createDraftRepository(db: DbClient): DraftRepository {
  async function writeChildren(companyId: string, draftId: string, content: DraftContent) {
    if (content.lines.length > 0) {
      await db.invoiceDraftLine.createMany({
        data: content.lines.map((line, index) => ({
          draftId,
          companyId,
          position: index + 1,
          productId: line.productId,
          quantity: FiscalDecimal.parse("cantidad", line.quantity).toDatabase(),
          discount: FiscalDecimal.parse("importe", line.discount).toDatabase(),
        })),
      });
    }
    if (content.payments.length > 0) {
      await db.invoiceDraftPayment.createMany({
        data: content.payments.map((payment, index) => ({
          draftId,
          companyId,
          position: index + 1,
          entryKey: payment.paymentMethod,
          amount:
            payment.amount === null
              ? null
              : FiscalDecimal.parse("importe", payment.amount).toDatabase(),
        })),
      });
    }
  }

  const find = async (companyId: string, draftId: string) => {
    const row = await db.invoiceDraft.findFirst({
      where: { id: draftId, companyId },
      include: INCLUDE,
    });
    return row ? toRecord(row) : null;
  };

  return {
    async create(companyId, content, userId) {
      const draft = await db.invoiceDraft.create({
        data: {
          companyId,
          emissionPointId: content.emissionPointId,
          buyerPartyId: content.buyerPartyId,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await writeChildren(companyId, draft.id, content);
      return (await find(companyId, draft.id))!;
    },

    find,

    async list(companyId, { page, pageSize }) {
      const where = { companyId, status: "DRAFT" };
      const [rows, total] = await Promise.all([
        db.invoiceDraft.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.invoiceDraft.count({ where }),
      ]);
      return { items: rows.map(toRecord), total };
    },

    async updateIfVersion(companyId, draftId, expectedVersion, content, userId) {
      const { count } = await db.invoiceDraft.updateMany({
        where: { id: draftId, companyId, status: "DRAFT", version: expectedVersion },
        data: {
          emissionPointId: content.emissionPointId,
          buyerPartyId: content.buyerPartyId,
          version: { increment: 1 },
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });
      if (count === 0) return false;
      await db.invoiceDraftLine.deleteMany({ where: { draftId, companyId } });
      await db.invoiceDraftPayment.deleteMany({ where: { draftId, companyId } });
      await writeChildren(companyId, draftId, content);
      return true;
    },

    async deleteIfDraft(companyId, draftId) {
      const { count } = await db.invoiceDraft.deleteMany({
        where: { id: draftId, companyId, status: "DRAFT" },
      });
      return count > 0;
    },
  };
}

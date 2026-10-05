// Repositorio de borradores de nota de crédito sobre Prisma (add-credit-notes, design D5). Las
// cantidades viajan como texto canónico y nunca pasan por `number`. En una anulación total la línea
// guarda la cantidad original, que el borrador no expone: no se elige.
import type { DbClient } from "../../../platform/db/database.ts";
import { FiscalDecimal } from "../../../platform/decimal/fiscal-decimal.ts";
import type { CreditNoteDraftRepository, StoredDraftContent } from "../application/ports.ts";
import type { CreditNoteDraftRecord, CreditNoteDraftStatus } from "../domain/draft.ts";
import type { CreditNoteCause } from "@facturador/contracts";

const INCLUDE = { lines: { orderBy: { position: "asc" as const } } };

type Row = {
  id: string;
  companyId: string;
  invoiceId: string;
  emissionPointId: string | null;
  cause: string;
  reason: string | null;
  status: string;
  documentId: string | null;
  version: number;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  lines: {
    position: number;
    quantity: { toFixed(): string };
    physicalReturn: { toFixed(): string };
  }[];
};

const quantity = (value: { toFixed(): string }) =>
  FiscalDecimal.fromDatabase("cantidad", value).toString();

const toRecord = (row: Row): CreditNoteDraftRecord => {
  const cause = row.cause as CreditNoteCause;
  return {
    id: row.id,
    companyId: row.companyId,
    invoiceId: row.invoiceId,
    emissionPointId: row.emissionPointId,
    cause,
    reason: row.reason,
    status: row.status as CreditNoteDraftStatus,
    documentId: row.documentId,
    version: row.version,
    lines: row.lines.map((line) => ({
      position: line.position,
      ...(cause === "RETURN" ? { quantity: quantity(line.quantity) } : {}),
      physicalReturn: quantity(line.physicalReturn),
    })),
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
};

export function createCreditNoteDraftRepository(db: DbClient): CreditNoteDraftRepository {
  async function writeLines(companyId: string, draftId: string, content: StoredDraftContent) {
    if (content.lines.length === 0) return;
    await db.creditNoteDraftLine.createMany({
      data: content.lines.map((line) => ({
        draftId,
        companyId,
        position: line.position,
        quantity: FiscalDecimal.parse("cantidad", line.quantity).toDatabase(),
        physicalReturn: FiscalDecimal.parse("cantidad", line.physicalReturn).toDatabase(),
      })),
    });
  }

  const find = async (companyId: string, draftId: string) => {
    const row = await db.creditNoteDraft.findFirst({
      where: { id: draftId, companyId },
      include: INCLUDE,
    });
    return row ? toRecord(row) : null;
  };

  return {
    async create(companyId, invoiceId, content, userId) {
      const draft = await db.creditNoteDraft.create({
        data: {
          companyId,
          invoiceId,
          emissionPointId: content.emissionPointId,
          cause: content.cause,
          reason: content.reason,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await writeLines(companyId, draft.id, content);
      return (await find(companyId, draft.id))!;
    },

    find,

    async list(companyId, { page, pageSize }) {
      const where = { companyId, status: "DRAFT" };
      const [rows, total] = await Promise.all([
        db.creditNoteDraft.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.creditNoteDraft.count({ where }),
      ]);
      return { items: rows.map(toRecord), total };
    },

    async updateIfVersion(companyId, draftId, expectedVersion, content, userId) {
      const { count } = await db.creditNoteDraft.updateMany({
        where: { id: draftId, companyId, status: "DRAFT", version: expectedVersion },
        data: {
          emissionPointId: content.emissionPointId,
          cause: content.cause,
          reason: content.reason,
          version: { increment: 1 },
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });
      if (count === 0) return false;
      await db.creditNoteDraftLine.deleteMany({ where: { draftId, companyId } });
      await writeLines(companyId, draftId, content);
      return true;
    },

    async deleteIfDraft(companyId, draftId) {
      const { count } = await db.creditNoteDraft.deleteMany({
        where: { id: draftId, companyId, status: "DRAFT" },
      });
      return count > 0;
    },
  };
}

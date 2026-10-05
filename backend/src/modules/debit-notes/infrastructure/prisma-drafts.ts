// Repositorio de borradores de nota de débito sobre Prisma (add-debit-notes, design D20 y D26). Los
// importes viajan como texto canónico y nunca pasan por `number`; cada campo de un concepto puede
// faltar mientras se prepara.
import type { DebitNoteCause } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import { FiscalDecimal, roundHalfUp } from "../../../platform/decimal/fiscal-decimal.ts";
import type { DebitNoteDraftRepository } from "../application/ports.ts";
import type {
  DebitNoteDraftContent,
  DebitNoteDraftRecord,
  DebitNoteDraftStatus,
} from "../domain/draft.ts";

const INCLUDE = { concepts: { orderBy: { position: "asc" as const } } };

type Row = {
  id: string;
  companyId: string;
  invoiceId: string;
  emissionPointId: string | null;
  paymentMethod: string | null;
  status: string;
  documentId: string | null;
  version: number;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  concepts: {
    position: number;
    cause: string | null;
    description: string | null;
    amount: { toFixed(): string } | null;
    taxTreatment: string | null;
  }[];
};

/** Importe guardado con su forma de dos decimales: un importe del dominio no se redondea. */
const money = (value: { toFixed(): string }) =>
  roundHalfUp(FiscalDecimal.fromDatabase("importe", value).toString(), 2);

const toRecord = (row: Row): DebitNoteDraftRecord => ({
  id: row.id,
  companyId: row.companyId,
  invoiceId: row.invoiceId,
  emissionPointId: row.emissionPointId,
  paymentMethod: row.paymentMethod,
  status: row.status as DebitNoteDraftStatus,
  documentId: row.documentId,
  version: row.version,
  concepts: row.concepts.map((concept) => ({
    cause: concept.cause as DebitNoteCause | null,
    description: concept.description,
    amount: concept.amount ? money(concept.amount) : null,
    taxTreatment: concept.taxTreatment,
  })),
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedBy,
});

export function createDebitNoteDraftRepository(db: DbClient): DebitNoteDraftRepository {
  async function writeConcepts(companyId: string, draftId: string, content: DebitNoteDraftContent) {
    if (content.concepts.length === 0) return;
    await db.debitNoteDraftConcept.createMany({
      data: content.concepts.map((concept, index) => ({
        draftId,
        companyId,
        position: index + 1,
        cause: concept.cause,
        description: concept.description,
        amount:
          concept.amount === null
            ? null
            : FiscalDecimal.parse("importe", concept.amount).toDatabase(),
        taxTreatment: concept.taxTreatment,
      })),
    });
  }

  const find = async (companyId: string, draftId: string) => {
    const row = await db.debitNoteDraft.findFirst({
      where: { id: draftId, companyId },
      include: INCLUDE,
    });
    return row ? toRecord(row) : null;
  };

  return {
    async create(companyId, invoiceId, content, userId) {
      const draft = await db.debitNoteDraft.create({
        data: {
          companyId,
          invoiceId,
          emissionPointId: content.emissionPointId,
          paymentMethod: content.paymentMethod,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      await writeConcepts(companyId, draft.id, content);
      return (await find(companyId, draft.id))!;
    },

    find,

    async list(companyId, { page, pageSize }) {
      const where = { companyId, status: "DRAFT" };
      const [rows, total] = await Promise.all([
        db.debitNoteDraft.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.debitNoteDraft.count({ where }),
      ]);
      return { items: rows.map(toRecord), total };
    },

    async updateIfVersion(companyId, draftId, expectedVersion, content, userId) {
      const { count } = await db.debitNoteDraft.updateMany({
        where: { id: draftId, companyId, status: "DRAFT", version: expectedVersion },
        data: {
          emissionPointId: content.emissionPointId,
          paymentMethod: content.paymentMethod,
          version: { increment: 1 },
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });
      if (count === 0) return false;
      await db.debitNoteDraftConcept.deleteMany({ where: { draftId, companyId } });
      await writeConcepts(companyId, draftId, content);
      return true;
    },

    async deleteIfDraft(companyId, draftId) {
      const { count } = await db.debitNoteDraft.deleteMany({
        where: { id: draftId, companyId, status: "DRAFT" },
      });
      return count > 0;
    },
  };
}

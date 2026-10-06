// Repositorio de borradores de guía de remisión sobre Prisma (add-shipping-guides, design D26). Los
// destinatarios, con su sustento y su detalle, se guardan como el arreglo JSON que validó el
// contrato: un borrador es un documento de trabajo, no fiscal, y la verdad de la guía es su snapshot.
// Las cantidades viajan como texto exacto y nunca pasan por `number`.
import type { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { ShippingGuideDraftRepository } from "../application/ports.ts";
import type {
  DraftRecipient,
  DraftTransporter,
  ShippingGuideDraftContent,
  ShippingGuideDraftRecord,
  ShippingGuideDraftStatus,
} from "../domain/draft.ts";

type Row = Prisma.ShippingGuideDraftGetPayload<object>;

const isoDate = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const dbDate = (date: string | null) => (date ? new Date(`${date}T00:00:00.000Z`) : null);

const transporterOf = (row: Row): DraftTransporter | null => {
  if (row.transporterSource === "SELF") return { source: "SELF" };
  if (row.transporterSource === "PARTY" && row.carrierPartyId) {
    return { source: "PARTY", partyId: row.carrierPartyId };
  }
  return null;
};

const toRecord = (row: Row): ShippingGuideDraftRecord => ({
  id: row.id,
  companyId: row.companyId,
  emissionPointId: row.emissionPointId,
  originEstablishmentId: row.originEstablishmentId,
  departureAddress: row.departureAddress,
  transporter: transporterOf(row),
  plate: row.plate,
  transportStart: isoDate(row.transportStart),
  transportEnd: isoDate(row.transportEnd),
  recipients: row.recipients as unknown as DraftRecipient[],
  status: row.status as ShippingGuideDraftStatus,
  documentId: row.documentId,
  version: row.version,
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedBy,
});

const columns = (content: ShippingGuideDraftContent) => ({
  emissionPointId: content.emissionPointId,
  originEstablishmentId: content.originEstablishmentId,
  departureAddress: content.departureAddress,
  transporterSource: content.transporter?.source ?? null,
  carrierPartyId: content.transporter?.source === "PARTY" ? content.transporter.partyId : null,
  plate: content.plate,
  transportStart: dbDate(content.transportStart),
  transportEnd: dbDate(content.transportEnd),
  recipients: content.recipients as unknown as Prisma.InputJsonValue,
});

export function createShippingGuideDraftRepository(db: DbClient): ShippingGuideDraftRepository {
  const find = async (companyId: string, draftId: string) => {
    const row = await db.shippingGuideDraft.findFirst({ where: { id: draftId, companyId } });
    return row ? toRecord(row) : null;
  };

  return {
    async create(companyId, content, userId) {
      const row = await db.shippingGuideDraft.create({
        data: { companyId, ...columns(content), createdBy: userId, updatedBy: userId },
      });
      return toRecord(row);
    },

    find,

    async list(companyId, { page, pageSize }) {
      const where = { companyId, status: "DRAFT" };
      const [rows, total] = await Promise.all([
        db.shippingGuideDraft.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.shippingGuideDraft.count({ where }),
      ]);
      return { items: rows.map(toRecord), total };
    },

    async updateIfVersion(companyId, draftId, expectedVersion, content, userId) {
      const { count } = await db.shippingGuideDraft.updateMany({
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
      const { count } = await db.shippingGuideDraft.deleteMany({
        where: { id: draftId, companyId, status: "DRAFT" },
      });
      return count > 0;
    },
  };
}

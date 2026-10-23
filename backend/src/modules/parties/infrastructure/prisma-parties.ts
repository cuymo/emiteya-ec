// Repositorio de terceros sobre PostgreSQL (add-parties-and-products, design D3, D10 y D14). Toda
// consulta filtra por la empresa; la unicidad la decide la restricción única, que se traduce a un
// error de la aplicación; las correcciones y los cambios de estado son UPDATE condicionados.
import type { PartyRole, RecordStatus, SystemRecord } from "@facturador/contracts";
import type { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { escapeLike, searchKey } from "../../../platform/search/search-key.ts";
import { DuplicateIdentificationError, type PartyRepository } from "../application/ports.ts";
import { partySearchKeys, type PartyRecord } from "../domain/party.ts";

// Los correos del tercero viven en su propia tabla, en su orden (add-email-delivery, design D8).
const WITH_EMAILS = {
  emails: { select: { address: true }, orderBy: { position: "asc" } },
} as const satisfies Prisma.PartyInclude;

type PartyRow = Prisma.PartyGetPayload<{ include: typeof WITH_EMAILS }>;

const emailRows = (emails: readonly string[]) =>
  emails.map((address, index) => ({ position: index + 1, address }));

function toRecord(row: PartyRow): PartyRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    identificationType: row.identificationType,
    identification: row.identification,
    legalName: row.legalName,
    address: row.address,
    emails: row.emails.map((email) => email.address),
    phone: row.phone,
    roles: row.roles as PartyRole[],
    status: row.status as RecordStatus,
    systemRecord: row.systemRecord as SystemRecord | null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Violación de la restricción única (P2002 de Prisma o 23505 de PostgreSQL). */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "23505";
}

async function translateUnique<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateIdentificationError();
    throw error;
  }
}

export function createPartyRepository(db: DbClient): PartyRepository {
  return {
    async find(companyId, partyId) {
      const row = await db.party.findFirst({
        where: { id: partyId, companyId },
        include: WITH_EMAILS,
      });
      return row ? toRecord(row) : null;
    },

    async findByIdentification(companyId, identificationType, identification) {
      const row = await db.party.findUnique({
        where: {
          companyId_identificationType_identification: {
            companyId,
            identificationType,
            identification,
          },
        },
        include: WITH_EMAILS,
      });
      return row ? toRecord(row) : null;
    },

    async search(companyId, query) {
      const key = query.search ? escapeLike(searchKey(query.search)) : "";
      const where: Prisma.PartyWhereInput = {
        companyId,
        ...(query.status === "ALL" ? {} : { status: query.status }),
        ...(query.role ? { roles: { has: query.role } } : {}),
        ...(key
          ? {
              OR: [
                { searchIdentification: { startsWith: key } },
                { searchName: { contains: key } },
              ],
            }
          : {}),
      };
      // Orden estable: la clave elegida y, como desempate, el identificador.
      const orderBy: Prisma.PartyOrderByWithRelationInput[] =
        query.sort === "identification"
          ? [{ identification: query.direction }, { id: "asc" }]
          : [{ searchName: query.direction }, { id: "asc" }];
      const [rows, total] = await Promise.all([
        db.party.findMany({
          where,
          include: WITH_EMAILS,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.party.count({ where }),
      ]);
      return { items: rows.map(toRecord), total };
    },

    create(companyId, data, userId) {
      return translateUnique(async () =>
        toRecord(
          await db.party.create({
            data: {
              companyId,
              ...data,
              emails: { create: emailRows(data.emails) },
              ...partySearchKeys(data),
              createdBy: userId,
              updatedBy: userId,
            },
            include: WITH_EMAILS,
          }),
        ),
      );
    },

    updateIfVersion(companyId, partyId, expectedVersion, data, userId) {
      return translateUnique(async () => {
        const { emails, ...fields } = data;
        const { count } = await db.party.updateMany({
          where: { id: partyId, companyId, version: expectedVersion, systemRecord: null },
          data: {
            ...fields,
            ...partySearchKeys(data),
            version: { increment: 1 },
            updatedBy: userId,
          },
        });
        if (count !== 1) return false;
        // Corre en la transacción de la corrección: los correos se reemplazan junto con el tercero.
        await db.partyEmail.deleteMany({ where: { partyId, companyId } });
        await db.partyEmail.createMany({
          data: emailRows(emails).map((row) => ({ ...row, partyId, companyId })),
        });
        return true;
      });
    },

    async changeStatusIfDifferent(companyId, partyId, status, userId) {
      const { count } = await db.party.updateMany({
        where: { id: partyId, companyId, systemRecord: null, status: { not: status } },
        data: { status, version: { increment: 1 }, updatedBy: userId },
      });
      return count === 1;
    },
  };
}

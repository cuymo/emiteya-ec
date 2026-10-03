// Repositorio de terceros sobre PostgreSQL (add-parties-and-products, design D3, D10 y D14). Toda
// consulta filtra por la empresa; la unicidad la decide la restricción única, que se traduce a un
// error de la aplicación; las correcciones y los cambios de estado son UPDATE condicionados.
import type { PartyRole, RecordStatus, SystemRecord } from "@facturador/contracts";
import type { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { escapeLike, searchKey } from "../../../platform/search/search-key.ts";
import { DuplicateIdentificationError, type PartyRepository } from "../application/ports.ts";
import { partySearchKeys, type PartyRecord } from "../domain/party.ts";

type PartyRow = Prisma.PartyGetPayload<object>;

function toRecord(row: PartyRow): PartyRecord {
  return {
    id: row.id,
    companyId: row.companyId,
    identificationType: row.identificationType,
    identification: row.identification,
    legalName: row.legalName,
    address: row.address,
    email: row.email,
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
      const row = await db.party.findFirst({ where: { id: partyId, companyId } });
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
              ...partySearchKeys(data),
              createdBy: userId,
              updatedBy: userId,
            },
          }),
        ),
      );
    },

    updateIfVersion(companyId, partyId, expectedVersion, data, userId) {
      return translateUnique(async () => {
        const { count } = await db.party.updateMany({
          where: { id: partyId, companyId, version: expectedVersion, systemRecord: null },
          data: {
            ...data,
            ...partySearchKeys(data),
            version: { increment: 1 },
            updatedBy: userId,
          },
        });
        return count === 1;
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

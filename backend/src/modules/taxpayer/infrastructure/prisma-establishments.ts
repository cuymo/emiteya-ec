// Establecimientos y puntos de emisión en PostgreSQL (design D7). Cada consulta exige la empresa y
// los puntos se buscan además por su establecimiento: un identificador de otra empresa o de otro
// establecimiento no encuentra nada. La restricción única resuelve las altas simultáneas.
import type { DbClient } from "../../../platform/db/database.ts";
import {
  DuplicateCodeError,
  type EmissionPointRecord,
  type EstablishmentRecord,
  type EstablishmentRepository,
} from "../application/ports.ts";
import type { ActiveStatus } from "../domain/emission-structure.ts";

const status = (active: boolean): ActiveStatus => (active ? "ACTIVE" : "INACTIVE");

type PointRow = { id: string; establishmentId: string; code: string; active: boolean };
type EstablishmentRow = {
  id: string;
  code: string;
  address: string;
  active: boolean;
  emissionPoints: PointRow[];
};

const toPoint = (row: PointRow): EmissionPointRecord => ({
  id: row.id,
  establishmentId: row.establishmentId,
  code: row.code,
  status: status(row.active),
});

const toEstablishment = (row: EstablishmentRow): EstablishmentRecord => ({
  id: row.id,
  code: row.code,
  address: row.address,
  status: status(row.active),
  emissionPoints: row.emissionPoints.map(toPoint),
});

const withPoints = { emissionPoints: { orderBy: { code: "asc" as const } } };

/** Traduce la violación de la restricción única (P2002 de Prisma) a un error de la aplicación. */
async function uniqueCode<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "P2002") throw new DuplicateCodeError();
    throw error;
  }
}

export function createEstablishmentRepository(db: DbClient): EstablishmentRepository {
  return {
    async list(companyId) {
      const rows = await db.establishment.findMany({
        where: { companyId },
        orderBy: { code: "asc" },
        include: withPoints,
      });
      return rows.map(toEstablishment);
    },

    async find(companyId, establishmentId) {
      const row = await db.establishment.findFirst({
        where: { companyId, id: establishmentId },
        include: withPoints,
      });
      return row ? toEstablishment(row) : null;
    },

    async create(companyId, { code, address }) {
      const row = await uniqueCode(() =>
        db.establishment.create({ data: { companyId, code, address }, include: withPoints }),
      );
      return toEstablishment(row);
    },

    async update(companyId, establishmentId, input) {
      await db.establishment.updateMany({
        where: { companyId, id: establishmentId },
        data: {
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.status !== undefined ? { active: input.status === "ACTIVE" } : {}),
        },
      });
      const row = await db.establishment.findFirstOrThrow({
        where: { companyId, id: establishmentId },
        include: withPoints,
      });
      return toEstablishment(row);
    },

    async findPoint(companyId, establishmentId, emissionPointId) {
      const row = await db.emissionPoint.findFirst({
        where: { companyId, establishmentId, id: emissionPointId },
      });
      return row ? toPoint(row) : null;
    },

    async createPoint(companyId, establishmentId, { code }) {
      const row = await uniqueCode(() =>
        db.emissionPoint.create({ data: { companyId, establishmentId, code } }),
      );
      return toPoint(row);
    },

    async updatePoint(companyId, establishmentId, emissionPointId, input) {
      await db.emissionPoint.updateMany({
        where: { companyId, establishmentId, id: emissionPointId },
        data: { active: input.status === "ACTIVE" },
      });
      const row = await db.emissionPoint.findFirstOrThrow({
        where: { companyId, establishmentId, id: emissionPointId },
      });
      return toPoint(row);
    },
  };
}

// Punto predeterminado de cada membresía en PostgreSQL (design D8). Las claves compuestas impiden
// apuntar a un punto o a una membresía de otra empresa.
import type { DbClient } from "../../../platform/db/database.ts";
import type { DefaultEmissionPointRepository } from "../application/ports.ts";
import type { ActiveStatus } from "../domain/emission-structure.ts";

const status = (active: boolean): ActiveStatus => (active ? "ACTIVE" : "INACTIVE");

export function createDefaultEmissionPointRepository(db: DbClient): DefaultEmissionPointRepository {
  return {
    async find(companyId, userId) {
      const row = await db.memberDefaultEmissionPoint.findUnique({
        where: { companyId_userId: { companyId, userId } },
        include: { emissionPoint: { include: { establishment: true } } },
      });
      if (!row) return null;
      const { emissionPoint: point } = row;
      return {
        point: {
          id: point.id,
          establishmentId: point.establishmentId,
          code: point.code,
          status: status(point.active),
        },
        establishment: {
          id: point.establishment.id,
          code: point.establishment.code,
          address: point.establishment.address,
          status: status(point.establishment.active),
          emissionPoints: [],
        },
      };
    },

    async set(companyId, userId, emissionPointId) {
      if (emissionPointId === null) {
        await db.memberDefaultEmissionPoint.deleteMany({ where: { companyId, userId } });
        return;
      }
      await db.memberDefaultEmissionPoint.upsert({
        where: { companyId_userId: { companyId, userId } },
        create: { companyId, userId, emissionPointId },
        update: { emissionPointId },
      });
    },
  };
}

// Lectura de empresas con consultas propias (design D7 y D11).
import type { DbClient } from "../../../platform/db/database.ts";

export function createCompanyReader(db: DbClient) {
  return {
    exists: async () => (await db.organization.findFirst({ select: { id: true } })) !== null,
    listIds: async () =>
      (await db.organization.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } })).map(
        (row) => row.id,
      ),
  };
}

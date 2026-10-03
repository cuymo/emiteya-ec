// Persistencia del consumidor final (add-parties-and-products, design D5). Recibe el cliente o la
// transacción en curso; el iniciador de empresa escribe dentro de la transacción del aprovisionamiento.
import type { DbClient } from "../../../platform/db/database.ts";
import type { ConsumerFinalStore } from "../application/consumer-final.ts";
import { CONSUMER_FINAL, type ConsumerFinalRecord } from "../domain/consumer-final.ts";

export function createConsumerFinalStore(db: DbClient): ConsumerFinalStore & {
  insert(companyId: string, record: ConsumerFinalRecord): Promise<void>;
} {
  return {
    async companiesWithConsumerFinal(companyIds) {
      const rows = await db.party.findMany({
        where: { companyId: { in: [...companyIds] }, systemRecord: CONSUMER_FINAL },
        select: { companyId: true },
      });
      return new Set(rows.map((row) => row.companyId));
    },
    async insertMissing(companyIds, record) {
      // ON CONFLICT DO NOTHING sobre la unicidad por empresa, tipo e identificación.
      await db.party.createMany({
        data: companyIds.map((companyId) => ({ companyId, ...record })),
        skipDuplicates: true,
      });
    },
    async insert(companyId, record) {
      await db.party.create({ data: { companyId, ...record } });
    },
  };
}

// Fuente de los correos de los terceros (add-email-delivery, design D1 y D3): `parties` la exporta y
// el arranque la pasa al módulo de correo, que no lee las tablas de los terceros. Solo los terceros
// de la empresa pedida, con sus correos en su orden.
import type { DbClient } from "../../../platform/db/database.ts";

export function createPartyEmailSource(db: DbClient) {
  return {
    async emailsOf(
      companyId: string,
      partyIds: readonly string[],
    ): Promise<ReadonlyMap<string, readonly string[]>> {
      const rows = await db.partyEmail.findMany({
        where: { companyId, partyId: { in: [...partyIds] } },
        select: { partyId: true, address: true },
        orderBy: [{ partyId: "asc" }, { position: "asc" }],
      });
      const byParty = new Map<string, string[]>();
      for (const row of rows)
        byParty.set(row.partyId, [...(byParty.get(row.partyId) ?? []), row.address]);
      return byParty;
    },
  };
}

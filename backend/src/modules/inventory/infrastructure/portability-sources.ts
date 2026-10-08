// Fuentes de portabilidad del inventario (add-data-portability, design D4): las existencias como las
// registra el inventario y el kárdex completo de la empresa, nunca recalculados desde los
// comprobantes. Las cantidades son texto decimal.
import { canonicalDecimal } from "@facturador/contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import { qualifiedTable, sqlCompanyBatches } from "../../../platform/db/report-source.ts";

export function createInventoryPortabilitySources(schema: string) {
  const balances = qualifiedTable(schema, "stock_balance");
  const movements = qualifiedTable(schema, "stock_movement");
  return {
    stockBalances: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`b.product_id, b.balance::text AS balance, b.initialized_at, b.updated_at`,
        from: Prisma.sql`${balances} b WHERE b.company_id = ${companyId}`,
        orderBy: Prisma.sql`b.product_id`,
      }),
      map: (raw: {
        product_id: string;
        balance: string;
        initialized_at: Date;
        updated_at: Date;
      }) => ({
        productId: raw.product_id,
        balance: canonicalDecimal(raw.balance),
        initializedAt: raw.initialized_at,
        updatedAt: raw.updated_at,
      }),
    }),
    stockMovements: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`m.product_id, m.position, m.movement_type, m.delta::text AS delta,
          m.balance_after::text AS balance_after, m.document_number, m.origin, m.actor_user_id,
          m.reason, m.occurred_at`,
        from: Prisma.sql`${movements} m WHERE m.company_id = ${companyId}`,
        orderBy: Prisma.sql`m.occurred_at, m.product_id, m.position`,
      }),
      map: (raw: {
        product_id: string;
        position: number;
        movement_type: string;
        delta: string;
        balance_after: string;
        document_number: string | null;
        origin: string;
        actor_user_id: string | null;
        reason: string | null;
        occurred_at: Date;
      }) => ({
        productId: raw.product_id,
        position: raw.position,
        movementType: raw.movement_type,
        delta: canonicalDecimal(raw.delta),
        balanceAfter: canonicalDecimal(raw.balance_after),
        documentNumber: raw.document_number,
        origin: raw.origin,
        actorUserId: raw.actor_user_id,
        reason: raw.reason,
        occurredAt: raw.occurred_at,
      }),
    }),
  };
}

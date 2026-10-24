// Estado del correo de los comprobantes (add-email-delivery, design D10): `email` lo exporta y el
// arranque lo pasa a la bandeja y al tablero, que no leen sus tablas. El estado de un comprobante es
// el de su último envío. SQL calificado por el esquema de la conexión, como la cola.
import type { EmailDeliveryStatus, Environment } from "@facturador/contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { qualifiedTable } from "../../../platform/db/report-source.ts";

export function createEmailStatusSource(db: DbClient, schema = "public") {
  const table = qualifiedTable(schema, "email_delivery");
  /** El último envío de cada comprobante de la empresa, opcionalmente de unos pocos o de un ambiente. */
  const latest = (companyId: string, filter: Prisma.Sql) => Prisma.sql`
    SELECT DISTINCT ON ("document_id") "document_id", "status", "environment"
    FROM ${table}
    WHERE "company_id" = ${companyId} ${filter}
    ORDER BY "document_id", "created_at" DESC, "id" DESC`;

  return {
    async lastStatuses(
      companyId: string,
      documentIds: readonly string[],
    ): Promise<ReadonlyMap<string, EmailDeliveryStatus>> {
      if (documentIds.length === 0) return new Map();
      const rows = await db.$queryRaw<{ document_id: string; status: string }[]>(
        latest(companyId, Prisma.sql`AND "document_id" IN (${Prisma.join([...documentIds])})`),
      );
      return new Map(rows.map((row) => [row.document_id, row.status as EmailDeliveryStatus]));
    },

    /** Los comprobantes cuyo último envío falló, para el filtro de la bandeja. */
    async failedDocumentIds(companyId: string): Promise<readonly string[]> {
      const rows = await db.$queryRaw<{ document_id: string }[]>(Prisma.sql`
        SELECT "document_id" FROM (${latest(companyId, Prisma.empty)}) AS latest
        WHERE "status" = 'FAILED'`);
      return rows.map((row) => row.document_id);
    },

    /** Cuántos comprobantes del ambiente tienen su último envío fallido, para el aviso. */
    async countFailedDocuments(companyId: string, environment: Environment): Promise<number> {
      const [row] = await db.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT count(*) AS total FROM (${latest(companyId, Prisma.empty)}) AS latest
        WHERE "status" = 'FAILED' AND "environment" = ${environment}`);
      return Number(row?.total ?? 0);
    },

    /** Cuántos comprobantes del ambiente tienen su último envío en cola o reintentando. */
    async countPendingDocuments(companyId: string, environment: Environment): Promise<number> {
      const [row] = await db.$queryRaw<{ total: bigint }[]>(Prisma.sql`
        SELECT count(*) AS total FROM (${latest(companyId, Prisma.empty)}) AS latest
        WHERE "status" IN ('PENDING', 'RETRYING') AND "environment" = ${environment}`);
      return Number(row?.total ?? 0);
    },
  };
}

export type EmailStatusSource = ReturnType<typeof createEmailStatusSource>;

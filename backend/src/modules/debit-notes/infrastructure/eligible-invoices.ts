// Facturas elegibles para una nota de débito (add-debit-notes, design D20): autorizadas, de la
// empresa, sin consumidor final en su snapshot y del ambiente en que la empresa emite. Las notas de
// crédito y de débito no son facturas: nunca aparecen. El filtro sobre el JSON del snapshot no lo
// expresa Prisma: es una consulta con el esquema de la conexión, solo de lectura.
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { DebitEligibleInvoiceReader } from "../application/ports.ts";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Row = {
  id: string;
  document_number: string;
  issue_date: Date;
  buyer_identification: string;
  buyer_name: string;
  total: { toFixed(decimals: number): string };
};

export function createDebitEligibleInvoiceReader(
  db: DbClient | PrismaClient,
  schema: string,
): DebitEligibleInvoiceReader {
  if (!IDENTIFIER.test(schema)) throw new Error("esquema de base de datos inválido");
  const documents = Prisma.raw(`"${schema}"."electronic_document"`);
  return {
    async list(companyId, { search, environment, page, pageSize }) {
      const term = search?.trim() ?? "";
      const like = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      const where = Prisma.sql`
        d.company_id = ${companyId}
        AND d.document_type = '01'
        AND d.state = 'AUTHORIZED'
        AND (d.snapshot -> 'buyer' ->> 'consumerFinal') IS DISTINCT FROM 'true'
        AND (${environment}::text IS NULL OR d.environment = ${environment}::text)
        AND (${term} = '' OR d.document_number LIKE ${like}
          OR d.buyer_identification LIKE ${like} OR d.buyer_name ILIKE ${like})`;
      const [rows, counted] = await Promise.all([
        db.$queryRaw<Row[]>`
          SELECT d.id, d.document_number, d.issue_date, d.buyer_identification, d.buyer_name, d.total
          FROM ${documents} d
          WHERE ${where}
          ORDER BY d.issue_date DESC, d.created_at DESC, d.id DESC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        db.$queryRaw<{ total: bigint }[]>`
          SELECT count(*) AS total FROM ${documents} d WHERE ${where}`,
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          documentNumber: row.document_number,
          issueDate: row.issue_date.toISOString().slice(0, 10),
          buyerIdentification: row.buyer_identification,
          buyerName: row.buyer_name,
          total: row.total.toFixed(2),
        })),
        total: Number(counted[0]?.total ?? 0),
      };
    },
  };
}

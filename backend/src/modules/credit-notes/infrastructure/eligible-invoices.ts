// Facturas elegibles para una nota de crédito (add-credit-notes, design D16): autorizadas, de la
// empresa, sin consumidor final en su snapshot y con crédito disponible (sin capacidad todavía, o
// con lo reservado más lo aplicado por debajo del total). La comparación entre columnas no la
// expresa Prisma: es una consulta con el esquema de la conexión, solo de lectura.
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { EligibleInvoiceReader } from "../application/ports.ts";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Row = {
  id: string;
  document_number: string;
  issue_date: Date;
  buyer_identification: string;
  buyer_name: string;
  total: { toFixed(decimals: number): string };
  available: { toFixed(decimals: number): string };
};

export function createEligibleInvoiceReader(
  db: DbClient | PrismaClient,
  schema: string,
): EligibleInvoiceReader {
  if (!IDENTIFIER.test(schema)) throw new Error("esquema de base de datos inválido");
  const documents = Prisma.raw(`"${schema}"."electronic_document"`);
  const capacities = Prisma.raw(`"${schema}"."credit_capacity"`);
  return {
    async list(companyId, { search, page, pageSize }) {
      const term = search?.trim() ?? "";
      const like = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      const where = Prisma.sql`
        d.company_id = ${companyId}
        AND d.document_type = '01'
        AND d.state = 'AUTHORIZED'
        AND (d.snapshot -> 'buyer' ->> 'consumerFinal') IS DISTINCT FROM 'true'
        AND (c.invoice_id IS NULL OR c.reserved_total + c.applied_total < c.original_total)
        AND (${term} = '' OR d.document_number LIKE ${like}
          OR d.buyer_identification LIKE ${like} OR d.buyer_name ILIKE ${like})`;
      const [rows, counted] = await Promise.all([
        db.$queryRaw<Row[]>`
          SELECT d.id, d.document_number, d.issue_date, d.buyer_identification, d.buyer_name,
                 d.total, d.total - COALESCE(c.reserved_total + c.applied_total, 0) AS available
          FROM ${documents} d
          LEFT JOIN ${capacities} c ON c.company_id = d.company_id AND c.invoice_id = d.id
          WHERE ${where}
          ORDER BY d.issue_date DESC, d.created_at DESC, d.id DESC
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        db.$queryRaw<{ total: bigint }[]>`
          SELECT count(*) AS total
          FROM ${documents} d
          LEFT JOIN ${capacities} c ON c.company_id = d.company_id AND c.invoice_id = d.id
          WHERE ${where}`,
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          documentNumber: row.document_number,
          issueDate: row.issue_date.toISOString().slice(0, 10),
          buyerIdentification: row.buyer_identification,
          buyerName: row.buyer_name,
          total: row.total.toFixed(2),
          available: row.available.toFixed(2),
        })),
        total: Number(counted[0]?.total ?? 0),
      };
    },
  };
}

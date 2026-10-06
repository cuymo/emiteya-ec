// Facturas elegibles como sustento de una guía de remisión (add-shipping-guides, design D8 y D22):
// facturas autorizadas de la empresa en el ambiente en que la empresa emite, con búsqueda por número,
// identificación o nombre del comprador. Una factura a consumidor final también lo es: el destinatario
// de la guía es otro tercero identificado (política del MVP). La integridad la comprueba la vista
// previa con `invoiceCreditSource`. Solo de lectura, con el esquema de la conexión.
import { Prisma, type PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { ShippingEligibleInvoiceReader } from "../application/ports.ts";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

type Row = {
  id: string;
  document_number: string;
  issue_date: Date;
  buyer_identification: string;
  buyer_name: string;
  total: { toFixed(decimals: number): string };
};

export function createShippingEligibleInvoiceReader(
  db: DbClient | PrismaClient,
  schema: string,
): ShippingEligibleInvoiceReader {
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
        AND d.environment = ${environment}
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

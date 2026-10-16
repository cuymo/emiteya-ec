// Resumen de los comprobantes para el tablero de Inicio (decisión del propietario, 2026-10-16). Lee
// solo lo que cada comprobante congeló al reservar su número: sus columnas y las líneas de su
// snapshot; nunca el tercero, el producto ni el catálogo vigentes, y nunca un borrador. Las ventas son
// las facturas autorizadas del ambiente vigente; los meses son los de la fecha de emisión, que ya es
// la de Ecuador.
import {
  canonicalDecimal,
  type DocumentState,
  type DocumentType,
  type Environment,
} from "@facturador/contracts";
import { Prisma } from "../../../../generated/prisma/client.ts";
import type { DbClient } from "../../../../platform/db/database.ts";
import { qualifiedTable } from "../../../../platform/db/report-source.ts";

export type DocumentSummaryQuery = Readonly<{
  environment: Environment;
  /** Hoy en Ecuador (`YYYY-MM-DD`). */
  today: string;
  /** Comprobantes con la transmisión detenida: requieren atención aunque su estado no lo diga. */
  stoppedIds: readonly string[];
}>;

export type DocumentSummary = Readonly<{
  monthly: readonly Readonly<{ month: string; authorizedTotal: string; authorizedCount: number }>[];
  byType: readonly Readonly<{
    documentType: DocumentType;
    issued: number;
    authorized: number;
    authorizedTotal: string | null;
  }>[];
  attention: number;
  rejectedLast30Days: number;
  topCustomers: readonly Readonly<{
    identification: string;
    name: string;
    authorizedTotal: string;
    invoices: number;
  }>[];
  topProducts: readonly Readonly<{
    mainCode: string | null;
    description: string;
    quantity: string;
    total: string;
  }>[];
  recent: readonly Readonly<{
    id: string;
    documentType: DocumentType;
    documentNumber: string;
    issueDate: string;
    counterpart: string | null;
    total: string | null;
    state: DocumentState;
  }>[];
}>;

/** Estados que piden la intervención de alguien, en cualquier tipo de comprobante. */
const ATTENTION_STATES = ["SEND_UNKNOWN", "MANUAL_REVIEW"];
const REJECTED_STATES = ["RETURNED", "NOT_AUTHORIZED"];
const TOP = 5;
const RECENT = 6;

const decimal = (text: string | null) => (text === null ? null : canonicalDecimal(text));

export function createDocumentSummary(schema: string) {
  const documents = qualifiedTable(schema, "electronic_document");

  return async function documentSummary(
    db: DbClient,
    companyId: string,
    { environment, today, stoppedIds }: DocumentSummaryQuery,
  ): Promise<DocumentSummary> {
    const scope = Prisma.sql`d.company_id = ${companyId} AND d.environment = ${environment}`;
    const monthStart = Prisma.sql`date_trunc('month', ${today}::date)::date`;
    const inMonth = Prisma.sql`d.issue_date >= ${monthStart} AND d.issue_date <= ${today}::date`;
    const authorizedInvoices = Prisma.sql`d.document_type = '01' AND d.state = 'AUTHORIZED'`;

    const [monthly, byType, flags, customers, products, recent] = await Promise.all([
      db.$queryRaw<{ month: string; total: string; count: number }[]>`
        SELECT to_char(m, 'YYYY-MM') AS month,
          coalesce(sum(d.total) FILTER (WHERE ${authorizedInvoices}), 0)::text AS total,
          (count(d.id) FILTER (WHERE ${authorizedInvoices}))::int AS count
        FROM generate_series(
          date_trunc('month', ${today}::date) - interval '5 months',
          date_trunc('month', ${today}::date),
          interval '1 month'
        ) AS m
        LEFT JOIN ${documents} d
          ON ${scope} AND date_trunc('month', d.issue_date) = m AND d.issue_date <= ${today}::date
        GROUP BY m
        ORDER BY m`,
      db.$queryRaw<
        { document_type: DocumentType; issued: number; authorized: number; total: string | null }[]
      >`
        SELECT d.document_type,
          count(*)::int AS issued,
          (count(*) FILTER (WHERE d.state = 'AUTHORIZED'))::int AS authorized,
          (sum(d.total) FILTER (WHERE d.state = 'AUTHORIZED'))::text AS total
        FROM ${documents} d
        WHERE ${scope} AND ${inMonth}
        GROUP BY d.document_type
        ORDER BY d.document_type`,
      db.$queryRaw<{ attention: number; rejected: number }[]>`
        SELECT
          (count(*) FILTER (
            WHERE d.state IN (${Prisma.join(ATTENTION_STATES)})
              OR d.id = ANY(${[...stoppedIds]}::text[])
          ))::int AS attention,
          (count(*) FILTER (
            WHERE d.state IN (${Prisma.join(REJECTED_STATES)})
              AND d.issue_date > ${today}::date - 30
          ))::int AS rejected
        FROM ${documents} d
        WHERE ${scope}`,
      db.$queryRaw<{ identification: string; name: string; total: string; invoices: number }[]>`
        SELECT d.buyer_identification AS identification, d.buyer_name AS name,
          sum(d.total)::text AS total, count(*)::int AS invoices
        FROM ${documents} d
        WHERE ${scope} AND ${inMonth} AND ${authorizedInvoices}
        GROUP BY d.buyer_identification, d.buyer_name
        ORDER BY sum(d.total) DESC, d.buyer_name
        LIMIT ${TOP}`,
      db.$queryRaw<
        { main_code: string | null; description: string; quantity: string; total: string }[]
      >`
        SELECT line->>'mainCode' AS main_code, line->>'description' AS description,
          sum((line->>'quantity')::numeric)::text AS quantity,
          sum((line->>'taxableBase')::numeric)::text AS total
        FROM ${documents} d
        CROSS JOIN LATERAL jsonb_array_elements(d.snapshot->'lines') AS line
        WHERE ${scope} AND ${inMonth} AND ${authorizedInvoices}
        GROUP BY line->>'mainCode', line->>'description'
        ORDER BY sum((line->>'taxableBase')::numeric) DESC, line->>'description'
        LIMIT ${TOP}`,
      db.$queryRaw<
        {
          id: string;
          document_type: DocumentType;
          document_number: string;
          issue_date: string;
          buyer_name: string | null;
          total: string | null;
          state: DocumentState;
        }[]
      >`
        SELECT d.id, d.document_type, d.document_number, d.issue_date::text AS issue_date,
          d.buyer_name, d.total::text AS total, d.state
        FROM ${documents} d
        WHERE ${scope}
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT ${RECENT}`,
    ]);

    return {
      monthly: monthly.map((row) => ({
        month: row.month,
        authorizedTotal: canonicalDecimal(row.total),
        authorizedCount: row.count,
      })),
      byType: byType.map((row) => ({
        documentType: row.document_type,
        issued: row.issued,
        authorized: row.authorized,
        // La guía de remisión no tiene total: su suma es nula.
        authorizedTotal: row.document_type === "06" ? null : canonicalDecimal(row.total ?? "0"),
      })),
      attention: flags[0]?.attention ?? 0,
      rejectedLast30Days: flags[0]?.rejected ?? 0,
      topCustomers: customers.map((row) => ({
        identification: row.identification,
        name: row.name,
        authorizedTotal: canonicalDecimal(row.total),
        invoices: row.invoices,
      })),
      topProducts: products.map((row) => ({
        mainCode: row.main_code,
        description: row.description,
        quantity: canonicalDecimal(row.quantity),
        total: canonicalDecimal(row.total),
      })),
      recent: recent.map((row) => ({
        id: row.id,
        documentType: row.document_type,
        documentNumber: row.document_number,
        issueDate: row.issue_date,
        counterpart: row.buyer_name,
        total: decimal(row.total),
        state: row.state,
      })),
    };
  };
}

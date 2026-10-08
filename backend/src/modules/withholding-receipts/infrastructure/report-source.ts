// Fuente del reporte de Retenciones (add-reports-export, design D1, D2, D3 y D5): una fila por línea
// de retención, desde las líneas inmutables y el registro de la retención, con el número, la fecha,
// el estado, el ambiente y el sujeto retenido que el comprobante congeló al reservar, y la
// denominación del impuesto de su snapshot. Un cambio posterior del tercero o del catálogo no cambia
// la fila. Orden: el de la bandeja y, dentro de un comprobante, el documento sustento y la línea.
import {
  canonicalDecimal,
  type DocumentState,
  type Environment,
  type ReportEnvironment,
  type WithholdingRow,
  type WithholdingTaxCode,
  type WithholdingsFilters,
} from "@facturador/contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import {
  qualifiedTable,
  sqlReportSource,
  type ReportSource,
} from "../../../platform/db/report-source.ts";

export type WithholdingsSourceFilters = Omit<WithholdingsFilters, "environment"> & {
  environment: ReportEnvironment;
};

type Raw = {
  document_id: string;
  support_position: number;
  position: number;
  issue_date: string;
  document_number: string;
  buyer_identification: string;
  buyer_name: string;
  fiscal_period: string;
  tax: string;
  tax_label: string;
  withholding_code: string;
  base: string;
  percentage: string;
  amount: string;
  state: string;
  environment: string;
};

/** El filtro `AAAA-MM` en la forma `MM/AAAA` que guarda la retención. */
const storedFiscalPeriod = (period: string) => `${period.slice(5, 7)}/${period.slice(0, 4)}`;

export function createWithholdingsReportSource(
  schema: string,
): ReportSource<WithholdingsSourceFilters, WithholdingRow> {
  const documents = qualifiedTable(schema, "electronic_document");
  const receipts = qualifiedTable(schema, "withholding_receipt");
  const lines = qualifiedTable(schema, "withholding_receipt_line");
  return sqlReportSource<WithholdingsSourceFilters, Raw, WithholdingRow>({
    query: (companyId, filters) => ({
      select: Prisma.sql`l.document_id, l.support_position, l.position,
        to_char(d.issue_date, 'YYYY-MM-DD') AS issue_date, d.document_number,
        d.buyer_identification, d.buyer_name, w.fiscal_period, l.tax,
        COALESCE((
          SELECT item ->> 'taxLabel'
          FROM jsonb_array_elements(d.snapshot -> 'supports') AS support,
               jsonb_array_elements(support -> 'withholdings') AS item
          WHERE (support ->> 'position')::int = l.support_position
            AND (item ->> 'position')::int = l.position
          LIMIT 1
        ), l.tax) AS tax_label,
        l.withholding_code, l.base::text AS base, l.percentage::text AS percentage,
        l.amount::text AS amount, d.state, d.environment`,
      from: Prisma.sql`${lines} l
        JOIN ${receipts} w ON w.company_id = l.company_id AND w.document_id = l.document_id
        JOIN ${documents} d ON d.company_id = l.company_id AND d.id = l.document_id
        WHERE ${Prisma.join(
          [
            Prisma.sql`l.company_id = ${companyId}`,
            Prisma.sql`d.document_type = '07'`,
            ...(filters.from ? [Prisma.sql`d.issue_date >= ${filters.from}::date`] : []),
            ...(filters.to ? [Prisma.sql`d.issue_date <= ${filters.to}::date`] : []),
            ...(filters.state !== "ALL" ? [Prisma.sql`d.state = ${filters.state}`] : []),
            ...(filters.environment !== "ALL"
              ? [Prisma.sql`d.environment = ${filters.environment}`]
              : []),
            ...(filters.supplierIdentification
              ? [Prisma.sql`d.buyer_identification = ${filters.supplierIdentification}`]
              : []),
            ...(filters.fiscalPeriod
              ? [Prisma.sql`w.fiscal_period = ${storedFiscalPeriod(filters.fiscalPeriod)}`]
              : []),
          ],
          " AND ",
        )}`,
      orderBy: Prisma.sql`d.issue_date DESC, d.created_at DESC, d.id DESC,
        l.support_position ASC, l.position ASC`,
    }),
    map: (raw) => ({
      documentId: raw.document_id,
      supportPosition: raw.support_position,
      position: raw.position,
      issueDate: raw.issue_date,
      number: raw.document_number,
      supplier: { identification: raw.buyer_identification, name: raw.buyer_name },
      fiscalPeriod: raw.fiscal_period,
      tax: raw.tax as WithholdingTaxCode,
      taxLabel: raw.tax_label,
      code: raw.withholding_code,
      base: canonicalDecimal(raw.base),
      percentage: canonicalDecimal(raw.percentage),
      amount: canonicalDecimal(raw.amount),
      state: raw.state as DocumentState,
      environment: raw.environment as Environment,
    }),
  });
}

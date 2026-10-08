// Fuente de portabilidad de las líneas de retención (add-data-portability, design D4): una fila por
// línea de cada comprobante de retención, de sus tablas inmutables, con la clave de acceso del
// comprobante. Los importes y el porcentaje son texto decimal.
import { canonicalDecimal } from "@facturador/contracts";
import { Prisma } from "../../../generated/prisma/client.ts";
import { qualifiedTable, sqlCompanyBatches } from "../../../platform/db/report-source.ts";

export function createWithholdingPortabilitySources(schema: string) {
  const lines = qualifiedTable(schema, "withholding_receipt_line");
  const documents = qualifiedTable(schema, "electronic_document");
  return {
    withholdingLines: sqlCompanyBatches({
      query: (companyId) => ({
        select: Prisma.sql`d.access_key, l.support_position, l.position, l.support_document_type,
          l.support_number, to_char(l.support_issue_date, 'YYYY-MM-DD') AS support_issue_date,
          l.tax, l.withholding_code, l.base::text AS base, l.percentage::text AS percentage,
          l.amount::text AS amount`,
        from: Prisma.sql`${lines} l
          JOIN ${documents} d ON d.company_id = l.company_id AND d.id = l.document_id
          WHERE l.company_id = ${companyId}`,
        orderBy: Prisma.sql`d.environment, d.document_number, l.support_position, l.position`,
      }),
      map: (raw: {
        access_key: string;
        support_position: number;
        position: number;
        support_document_type: string;
        support_number: string;
        support_issue_date: string;
        tax: string;
        withholding_code: string;
        base: string;
        percentage: string;
        amount: string;
      }) => ({
        accessKey: raw.access_key,
        supportPosition: raw.support_position,
        position: raw.position,
        supportDocumentType: raw.support_document_type,
        supportNumber: raw.support_number,
        supportIssueDate: raw.support_issue_date,
        tax: raw.tax,
        withholdingCode: raw.withholding_code,
        base: canonicalDecimal(raw.base),
        percentage: canonicalDecimal(raw.percentage),
        amount: canonicalDecimal(raw.amount),
      }),
    }),
  };
}

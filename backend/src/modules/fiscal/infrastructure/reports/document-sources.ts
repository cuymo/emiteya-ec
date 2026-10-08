// Fuentes de Documentos emitidos y de Facturas (add-reports-export, design D1, D2, D3 y D5). Leen
// solo las columnas que el comprobante congeló al reservar su número, sus destinatarios y los
// importes de su snapshot; nunca el tercero, el producto ni el catálogo vigentes, y nunca un
// borrador, que no es un comprobante. Orden total de la bandeja: fecha de emisión, creación e
// identificador, del más reciente al más antiguo.
import {
  DOCUMENT_TYPES,
  canonicalDecimal,
  type DocumentState,
  type DocumentType,
  type Environment,
  type InvoiceRow,
  type InvoicesFilters,
  type IssuedDocumentRow,
  type IssuedDocumentsFilters,
  type ReportEnvironment,
} from "@facturador/contracts";
import { Prisma } from "../../../../generated/prisma/client.ts";
import {
  qualifiedTable,
  sqlReportSource,
  type ReportSource,
} from "../../../../platform/db/report-source.ts";
import type { InvoiceTaxProjection, ReportAmountProjection } from "./amount-projections.ts";

/** Los filtros del reporte con el ambiente efectivo que resolvió el servidor. */
export type IssuedDocumentsSourceFilters = Omit<IssuedDocumentsFilters, "environment"> & {
  environment: ReportEnvironment;
};
export type InvoicesSourceFilters = Omit<InvoicesFilters, "environment"> & {
  environment: ReportEnvironment;
};

const SNAPSHOT = Prisma.sql`d.snapshot`;
const ORDER = Prisma.sql`d.issue_date DESC, d.created_at DESC, d.id DESC`;

const amountText = (text: string | null) => (text === null ? null : canonicalDecimal(text));

/** Condiciones comunes: la empresa, el rango de emisión, el estado y el ambiente. */
function commonWhere(
  companyId: string,
  filters: { from?: string; to?: string; state: string; environment: ReportEnvironment },
): Prisma.Sql[] {
  return [
    Prisma.sql`d.company_id = ${companyId}`,
    ...(filters.from ? [Prisma.sql`d.issue_date >= ${filters.from}::date`] : []),
    ...(filters.to ? [Prisma.sql`d.issue_date <= ${filters.to}::date`] : []),
    ...(filters.state !== "ALL" ? [Prisma.sql`d.state = ${filters.state}`] : []),
    ...(filters.environment !== "ALL" ? [Prisma.sql`d.environment = ${filters.environment}`] : []),
  ];
}

const and = (conditions: readonly Prisma.Sql[]) => Prisma.join(conditions, " AND ");

/** `CASE` por tipo compuesto desde las proyecciones; un tipo sin la expresión da NULL. */
function byType(
  projections: readonly ReportAmountProjection[],
  pick: (projection: ReportAmountProjection) => ReportAmountProjection["subtotal"],
): Prisma.Sql {
  const branches = projections.flatMap((projection) => {
    const expression = pick(projection);
    return expression
      ? [Prisma.sql`WHEN ${projection.documentType} THEN ${expression(SNAPSHOT)}`]
      : [];
  });
  return branches.length === 0
    ? Prisma.sql`NULL::numeric`
    : Prisma.sql`CASE d.document_type ${Prisma.join(branches, " ")} END`;
}

/** Exige exactamente una proyección por cada uno de los seis tipos de comprobante. */
function checkProjections(projections: readonly ReportAmountProjection[]): void {
  const types = projections.map((projection) => projection.documentType).sort();
  if (JSON.stringify(types) !== JSON.stringify([...DOCUMENT_TYPES].sort())) {
    throw new Error("Cada tipo de comprobante necesita exactamente una proyección de importes.");
  }
}

type IssuedRaw = {
  id: string;
  issue_date: string;
  document_type: string;
  document_number: string;
  buyer_identification: string | null;
  buyer_name: string | null;
  recipient_count: number | null;
  recipient_identification: string | null;
  recipient_name: string | null;
  subtotal: string | null;
  taxes: string | null;
  total: string | null;
  state: string;
  environment: string;
};

export function createIssuedDocumentsReportSource(
  schema: string,
  projections: readonly ReportAmountProjection[],
): ReportSource<IssuedDocumentsSourceFilters, IssuedDocumentRow> {
  checkProjections(projections);
  const documents = qualifiedTable(schema, "electronic_document");
  const recipients = qualifiedTable(schema, "electronic_document_recipient");
  const subtotal = byType(projections, (projection) => projection.subtotal);
  const taxes = byType(projections, (projection) => projection.taxes);
  return sqlReportSource<IssuedDocumentsSourceFilters, IssuedRaw, IssuedDocumentRow>({
    query: (companyId, filters) => ({
      select: Prisma.sql`d.id, to_char(d.issue_date, 'YYYY-MM-DD') AS issue_date,
        d.document_type, d.document_number, d.buyer_identification, d.buyer_name,
        r.recipient_count, r.recipient_identification, r.recipient_name,
        (${subtotal})::text AS subtotal, (${taxes})::text AS taxes, d.total::text AS total,
        d.state, d.environment`,
      // Los destinatarios solo se cuentan para la guía (design D5): el único con su identificación,
      // o su cantidad.
      from: Prisma.sql`${documents} d
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS recipient_count,
                 min(er.identification) AS recipient_identification,
                 min(er.name) AS recipient_name
          FROM ${recipients} er
          WHERE d.document_type = '06' AND er.company_id = d.company_id AND er.document_id = d.id
        ) r ON d.document_type = '06'
        WHERE ${and([
          ...commonWhere(companyId, filters),
          ...(filters.documentType ? [Prisma.sql`d.document_type = ${filters.documentType}`] : []),
          ...(filters.establishmentId
            ? [Prisma.sql`d.establishment_id = ${filters.establishmentId}`]
            : []),
          ...(filters.emissionPointId
            ? [Prisma.sql`d.emission_point_id = ${filters.emissionPointId}`]
            : []),
        ])}`,
      orderBy: ORDER,
    }),
    map: (raw) => {
      const guide = raw.document_type === "06";
      const count = guide ? (raw.recipient_count ?? 0) : null;
      return {
        id: raw.id,
        issueDate: raw.issue_date,
        documentType: raw.document_type as DocumentType,
        number: raw.document_number,
        counterpart: guide
          ? count === 1
            ? { identification: raw.recipient_identification!, name: raw.recipient_name! }
            : null
          : { identification: raw.buyer_identification!, name: raw.buyer_name! },
        recipientCount: count,
        subtotal: amountText(raw.subtotal),
        taxes: amountText(raw.taxes),
        total: amountText(raw.total),
        state: raw.state as DocumentState,
        environment: raw.environment as Environment,
      };
    },
  });
}

type InvoiceRaw = {
  id: string;
  issue_date: string;
  document_number: string;
  buyer_identification: string;
  buyer_name: string;
  subtotal: string;
  vat: string;
  other_taxes: string;
  total: string;
  state: string;
  environment: string;
};

export function createInvoicesReportSource(
  schema: string,
  projection: InvoiceTaxProjection,
): ReportSource<InvoicesSourceFilters, InvoiceRow> {
  const documents = qualifiedTable(schema, "electronic_document");
  return sqlReportSource<InvoicesSourceFilters, InvoiceRaw, InvoiceRow>({
    query: (companyId, filters) => ({
      select: Prisma.sql`d.id, to_char(d.issue_date, 'YYYY-MM-DD') AS issue_date,
        d.document_number, d.buyer_identification, d.buyer_name,
        (${projection.subtotal(SNAPSHOT)})::text AS subtotal,
        (${projection.vat(SNAPSHOT)})::text AS vat,
        (${projection.otherTaxes(SNAPSHOT)})::text AS other_taxes,
        d.total::text AS total, d.state, d.environment`,
      from: Prisma.sql`${documents} d WHERE ${and([
        ...commonWhere(companyId, filters),
        Prisma.sql`d.document_type = '01'`,
        ...(filters.customerIdentification
          ? [Prisma.sql`d.buyer_identification = ${filters.customerIdentification}`]
          : []),
      ])}`,
      orderBy: ORDER,
    }),
    map: (raw) => ({
      id: raw.id,
      issueDate: raw.issue_date,
      number: raw.document_number,
      customer: { identification: raw.buyer_identification, name: raw.buyer_name },
      subtotal: canonicalDecimal(raw.subtotal),
      vat: canonicalDecimal(raw.vat),
      otherTaxes: canonicalDecimal(raw.other_taxes),
      total: canonicalDecimal(raw.total),
      state: raw.state as DocumentState,
      environment: raw.environment as Environment,
    }),
  });
}

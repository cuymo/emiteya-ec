// Proyección de importes de los reportes (add-reports-export, design D5). Cada módulo de comprobante
// la declara sobre su propio snapshot, porque solo él conoce su forma, y `main.ts` las compone en la
// fuente de Documentos emitidos. Las expresiones leen del snapshot solo lo necesario y suman en SQL
// con `NUMERIC`: un importe nunca pasa por `number`.
import { Prisma } from "../../../../generated/prisma/client.ts";
import type { DocumentType } from "../../domain/numbering.ts";

/** Expresión SQL sobre el snapshot (`jsonb`) del comprobante. */
export type SnapshotExpression = (snapshot: Prisma.Sql) => Prisma.Sql;

export type ReportAmountProjection = Readonly<{
  documentType: DocumentType;
  /** Subtotal sin impuestos, o null si el tipo no lo tiene (la retención y la guía). */
  subtotal: SnapshotExpression | null;
  /** Suma de sus impuestos, o null si el tipo no los tiene. */
  taxes: SnapshotExpression | null;
}>;

/** Facturas separa el IVA (código 2) de los otros impuestos de la factura. */
export type InvoiceTaxProjection = Readonly<{
  subtotal: SnapshotExpression;
  vat: SnapshotExpression;
  otherTaxes: SnapshotExpression;
}>;

/** Código del IVA en la tabla de impuestos del SRI. */
export const VAT_TAX_CODE = "2";

/** Un importe del snapshot como `NUMERIC`: `jsonAmount(s, "totals", "withoutTaxes")`. */
export function jsonAmount(snapshot: Prisma.Sql, ...path: readonly string[]): Prisma.Sql {
  return Prisma.sql`(${snapshot} #>> ${`{${path.join(",")}}`}::text[])::numeric`;
}

/**
 * Suma exacta de `amount` en una lista de impuestos del snapshot, opcionalmente solo del IVA o sin
 * él. Una lista vacía suma 0.
 */
export function sumTaxAmounts(
  snapshot: Prisma.Sql,
  path: readonly string[],
  only: "all" | "vat" | "notVat" = "all",
): Prisma.Sql {
  const filter =
    only === "vat"
      ? Prisma.sql`WHERE tax ->> 'taxCode' = ${VAT_TAX_CODE}`
      : only === "notVat"
        ? Prisma.sql`WHERE tax ->> 'taxCode' <> ${VAT_TAX_CODE}`
        : Prisma.empty;
  return Prisma.sql`(SELECT COALESCE(sum((tax ->> 'amount')::numeric), 0)
    FROM jsonb_array_elements(${snapshot} #> ${`{${path.join(",")}}`}::text[]) AS tax ${filter})`;
}

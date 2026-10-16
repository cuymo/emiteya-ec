// Tablero de Inicio (decisión del propietario, 2026-10-16): un resumen de solo lectura de la
// actividad de la empresa en su ambiente vigente, calculado por el servidor. Las ventas son las
// facturas autorizadas; las sumas son cadenas decimales canónicas, como todo importe del sistema.
import { z } from "zod";
import { documentStateSchema } from "./archive.ts";
import { decimalStringSchema } from "./decimal.ts";
import { documentTypeSchema } from "./fiscal-numbering.ts";
import { environmentSchema } from "./taxpayer.ts";

const isoDate = z.iso.date();
const count = z.number().int().nonnegative();
/** Una suma de importes: puede superar el límite de un importe individual. */
const sum = decimalStringSchema;

export const dashboardViewSchema = z.strictObject({
  environment: environmentSchema,
  /** Fecha de hoy en Ecuador, la que fija el mes en curso. */
  today: isoDate,
  /** Desde el primer día del mes en curso hasta hoy. */
  month: z.strictObject({
    start: isoDate,
    invoices: z.strictObject({
      authorizedTotal: sum,
      authorizedCount: count,
      /** Facturas emitidas en el mes, en cualquier estado. */
      issuedCount: count,
      /** Lo autorizado en todo el mes anterior, para comparar. */
      previousAuthorizedTotal: sum,
    }),
    /** Un renglón por tipo con comprobantes en el mes; la guía no tiene total. */
    byType: z.array(
      z.strictObject({
        documentType: documentTypeSchema,
        issued: count,
        authorized: count,
        authorizedTotal: sum.nullable(),
      }),
    ),
  }),
  /** Los seis últimos meses, del más antiguo al actual, con lo facturado y autorizado. */
  monthly: z.array(
    z.strictObject({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      authorizedTotal: sum,
      authorizedCount: count,
    }),
  ),
  attention: z.strictObject({
    /** Resultado incierto, revisión manual o transmisión detenida, en cualquier tipo. */
    count,
    /** Devueltos o no autorizados en los últimos 30 días. */
    rejectedLast30Days: count,
  }),
  drafts: z.strictObject({ invoices: count }),
  inventory: z.strictObject({
    /** Productos con inventario inicializado y saldo cero o negativo. */
    outOfStock: count,
  }),
  /** Los cinco clientes con más facturado y autorizado en el mes. */
  topCustomers: z.array(
    z.strictObject({
      identification: z.string(),
      name: z.string(),
      authorizedTotal: sum,
      invoices: count,
    }),
  ),
  /** Los cinco productos con más base imponible facturada y autorizada en el mes. */
  topProducts: z.array(
    z.strictObject({
      mainCode: z.string().nullable(),
      description: z.string(),
      quantity: decimalStringSchema,
      total: sum,
    }),
  ),
  /** Los últimos comprobantes emitidos, de cualquier tipo. */
  recent: z.array(
    z.strictObject({
      id: z.string(),
      documentType: documentTypeSchema,
      documentNumber: z.string(),
      issueDate: isoDate,
      /** Comprador, proveedor o sujeto retenido; la guía no tiene uno. */
      counterpart: z.string().nullable(),
      total: sum.nullable(),
      state: documentStateSchema,
    }),
  ),
});
export type DashboardView = z.infer<typeof dashboardViewSchema>;

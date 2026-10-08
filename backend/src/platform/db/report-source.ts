// Fuentes de los reportes (add-reports-export, design D1 y D2). Cada módulo dueño exporta la lectura
// de solo lectura de su reporte, y `main.ts` la compone como puerto del módulo `reports`, que nunca
// lee tablas ajenas. Una fuente es una sola consulta ordenada: la página la recorre con LIMIT y
// OFFSET, la exportación con un cursor de la transacción en curso, y el conteo usa las mismas tablas
// y el mismo filtro. Así la lista y el XLSX no pueden divergir.
import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma/client.ts";
import type { DbClient } from "./database.ts";

export type ReportPage = Readonly<{ offset: number; limit: number }>;

export type ReportSource<F, R> = Readonly<{
  count(db: DbClient, companyId: string, filters: F): Promise<number>;
  page(db: DbClient, companyId: string, filters: F, page: ReportPage): Promise<R[]>;
  /**
   * Lotes en el mismo orden total que la página, con un cursor de PostgreSQL. Necesita una
   * transacción abierta en `db`: la de la exportación, en `REPEATABLE READ` de solo lectura.
   */
  batches(db: DbClient, companyId: string, filters: F, size: number): AsyncIterable<R[]>;
}>;

/** Partes de la consulta de un reporte, todas con las tablas calificadas por el esquema. */
export type ReportQuery = Readonly<{
  select: Prisma.Sql;
  /** `FROM`, los `JOIN` y el `WHERE` con la empresa: lo único que usa el conteo. */
  from: Prisma.Sql;
  /** Orden total, con el identificador como último desempate. */
  orderBy: Prisma.Sql;
}>;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Tabla calificada por el esquema de la conexión, como las demás lecturas con SQL. */
export function qualifiedTable(schema: string, table: string): Prisma.Sql {
  if (!IDENTIFIER.test(schema) || !IDENTIFIER.test(table)) {
    throw new Error("identificador de base de datos inválido");
  }
  return Prisma.raw(`"${schema}"."${table}"`);
}

export function sqlReportSource<F, Raw, R>(definition: {
  query(companyId: string, filters: F): ReportQuery;
  map(raw: Raw): R;
}): ReportSource<F, R> {
  const ordered = (query: ReportQuery) =>
    Prisma.sql`SELECT ${query.select} FROM ${query.from} ORDER BY ${query.orderBy}`;
  return {
    async count(db, companyId, filters) {
      const { from } = definition.query(companyId, filters);
      const [row] = await db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM ${from}`;
      return Number(row?.total ?? 0);
    },

    async page(db, companyId, filters, { offset, limit }) {
      const query = ordered(definition.query(companyId, filters));
      const rows = await db.$queryRaw<Raw[]>`${query} LIMIT ${limit} OFFSET ${offset}`;
      return rows.map((raw) => definition.map(raw));
    },

    async *batches(db, companyId, filters, size) {
      // FETCH no admite parámetros: el tamaño va literal, y por eso se valida.
      if (!Number.isInteger(size) || size < 1) throw new RangeError("tamaño de lote inválido");
      const query = ordered(definition.query(companyId, filters));
      // Nombre propio por recorrido: el identificador lo genera esta función.
      const cursor = Prisma.raw(`report_${randomUUID().replaceAll("-", "")}`);
      await db.$executeRaw`DECLARE ${cursor} NO SCROLL CURSOR FOR ${query}`;
      let open = true;
      try {
        for (;;) {
          const rows = await db.$queryRaw<
            Raw[]
          >`FETCH FORWARD ${Prisma.raw(String(size))} FROM ${cursor}`;
          if (rows.length === 0) break;
          yield rows.map((raw) => definition.map(raw));
          if (rows.length < size) break;
        }
        await db.$executeRaw`CLOSE ${cursor}`;
        open = false;
      } finally {
        // Si el recorrido se interrumpe, el cursor se cierra con la transacción; si sigue abierta,
        // se cierra aquí sin ocultar el error original.
        if (open) await db.$executeRaw`CLOSE ${cursor}`.catch(() => undefined);
      }
    },
  };
}

/** Lotes de una fuente sin filtros (add-data-portability, design D1): toda la empresa, en orden. */
export type CompanyBatches<R> = (
  db: DbClient,
  companyId: string,
  size: number,
) => AsyncIterable<R[]>;

/**
 * Una sola consulta ordenada de toda la empresa, recorrida por lotes con un cursor de la
 * transacción en curso: la fase 1 de la portabilidad, en `REPEATABLE READ` de solo lectura.
 */
export function sqlCompanyBatches<Raw, R>(definition: {
  query(companyId: string): ReportQuery;
  map(raw: Raw): R;
}): CompanyBatches<R> {
  const source = sqlReportSource<undefined, Raw, R>({
    query: (companyId) => definition.query(companyId),
    map: (raw) => definition.map(raw),
  });
  return (db, companyId, size) => source.batches(db, companyId, undefined, size);
}

// Libro de prueba del escritor XLSX (ADR 0023): las celdas difíciles del reporte de documentos
// emitidos, repetidas de forma determinista para cualquier número de filas.
import type { XlsxColumn, XlsxSheet, XlsxValue } from "../../src/platform/xlsx/xlsx-writer.ts";

export const FIXTURE_COLUMNS: readonly XlsxColumn[] = [
  { header: "Fecha", kind: "date", width: 11 },
  { header: "Número", kind: "text", width: 18 },
  { header: "Identificación", kind: "text", width: 16 },
  { header: "Tercero", kind: "text", width: 40 },
  { header: "Total", kind: "money", width: 14 },
  { header: "Cantidad", kind: "decimal", width: 16 },
  { header: "Momento", kind: "dateTime", width: 20 },
];

const NAMES = ["=1+1", "Cliente & <Hijos> S.A.", " =1+1", "\t=1+1", "Ñandú 🧾", "_x0041_"];
const TOTALS = ["0.10", "100.29", "106.00", "99999999999999.99", "-0.01", null];
const QUANTITIES = ["2.5", "1234.567891", "999999999999.999999", "5"];
const DATES = ["2026-10-07", "2024-02-29", "2026-01-01"];
const MOMENTS = [
  "2026-09-01T04:59:59.999Z",
  "2026-09-01T05:00:00.000Z",
  "2026-10-01T04:00:00.001Z",
];

export function fixtureRow(i: number): XlsxValue[] {
  return [
    DATES[i % DATES.length]!,
    `001-001-${String(i + 1).padStart(9, "0")}`,
    i % 2 === 0 ? "0102030405" : "1790012345001",
    NAMES[i % NAMES.length]!,
    TOTALS[i % TOTALS.length]!,
    QUANTITIES[i % QUANTITIES.length]!,
    new Date(MOMENTS[i % MOMENTS.length]!),
  ];
}

export async function* fixtureRows(count: number): AsyncGenerator<XlsxValue[]> {
  for (let i = 0; i < count; i += 1) {
    // Como los lotes de una lectura por cursor.
    if (i % 1000 === 0) await new Promise((resolve) => setImmediate(resolve));
    yield fixtureRow(i);
  }
}

export function fixtureSheets(count: number): XlsxSheet[] {
  return [
    { name: "Documentos emitidos", columns: FIXTURE_COLUMNS, rows: fixtureRows(count) },
    {
      name: "Filtros",
      columns: [
        { header: "Filtro", kind: "text", width: 24 },
        { header: "Valor", kind: "text", width: 40 },
      ],
      rows: [
        ["Reporte", "Documentos emitidos"],
        ["Desde", "01/09/2026"],
      ],
    },
  ];
}

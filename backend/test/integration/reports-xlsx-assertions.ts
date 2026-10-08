// Comparación de las filas de la API con las del XLSX de un reporte (add-reports-export, AC-09): el
// mismo número de filas, en el mismo orden, con cada celda del tipo de su columna y su valor exacto.
// La hora de Ecuador se calcula aparte del escritor.
import { Decimal } from "decimal.js";
import { expect } from "vitest";
import type { ReportId } from "@facturador/contracts";
import { REPORT_DEFINITIONS } from "../../src/modules/reports/domain/definitions.ts";
import { serialToWallClock, type XlsxBook } from "../support/xlsx-reader.ts";

const WALL = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Guayaquil",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
  hourCycle: "h23",
});
/** La hora de Ecuador de un momento, calculada aparte del escritor. */
const ecuadorWallClock = (moment: Date) => WALL.format(moment).replace(" ", "T").replace(",", ".");

const columnName = (index: number) => String.fromCharCode(65 + index);

/** Comprueba que el XLSX tiene exactamente las filas de la API, en el mismo orden y con sus valores. */
export function expectSameRows(report: ReportId, rows: Record<string, unknown>[], book: XlsxBook) {
  const definition = REPORT_DEFINITIONS[report];
  const sheet = book.sheets[0]!;
  expect(sheet.name).toBe(definition.label);
  expect([...sheet.rows.get(1)!.values()].map((cell) => cell.text)).toEqual(
    definition.columns.map((column) => column.header),
  );
  expect([report, sheet.rows.size]).toEqual([report, rows.length + 1]);
  rows.forEach((row, index) => {
    const cells = sheet.rows.get(index + 2)!;
    definition.columns.forEach((column, position) => {
      const value = (column.value as (row: unknown) => string | Date | null)(row);
      const cell = cells.get(columnName(position));
      const where = `${report} fila ${index + 2} ${column.header}`;
      if (value === null) {
        expect(cell, where).toBeUndefined();
        return;
      }
      expect(cell, where).toBeDefined();
      if (column.kind === "text") {
        expect([where, cell!.type, cell!.text, cell!.quotePrefix]).toEqual([
          where,
          "string",
          value,
          true,
        ]);
      } else if (column.kind === "money" || column.kind === "decimal") {
        if (cell!.type === "number") {
          expect([where, new Decimal(cell!.text).equals(new Decimal(value as string))]).toEqual([
            where,
            true,
          ]);
        } else {
          // Más de 15 dígitos significativos: el texto exacto.
          expect([where, cell!.text]).toEqual([where, value]);
        }
      } else if (column.kind === "date") {
        expect([where, serialToWallClock(cell!.text)]).toEqual([
          where,
          `${value as string}T00:00:00.000`,
        ]);
      } else {
        expect([where, serialToWallClock(cell!.text)]).toEqual([
          where,
          ecuadorWallClock(value as Date),
        ]);
      }
    });
  });
}

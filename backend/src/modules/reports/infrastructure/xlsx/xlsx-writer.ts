// Escritor XLSX de los reportes (ADR 0023; design D6, D7 y D8 de add-reports-export). Solo el
// subconjunto que necesitan los cinco reportes: hojas con una fila de encabezados fija y celdas de
// texto, numéricas, de fecha y de momento. No es un motor de hojas de cálculo: no lee libros ni
// escribe fórmulas, cadenas compartidas, temas ni propiedades del documento. Escribe por streaming
// a un archivo nuevo y privado; la memoria no depende del número de filas.
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  MAX_CELL_TEXT,
  MAX_FORMAT_DECIMALS,
  XlsxValueError,
  dateSerial,
  dateTimeSerial,
  numericValue,
  xmlText,
} from "./cells.ts";
import { zipBytes, type ZipEntry } from "./zip.ts";

/**
 * - `text`: siempre una celda de cadena con `quotePrefix`, nunca una fórmula.
 * - `money`: un importe con al menos dos decimales.
 * - `decimal`: una cantidad o un porcentaje con los decimales de su valor.
 * - `date`: una fecha ISO (`AAAA-MM-DD`).
 * - `dateTime`: un momento, en la hora de Ecuador.
 */
export type XlsxColumnKind = "text" | "money" | "decimal" | "date" | "dateTime";
export type XlsxColumn = {
  readonly header: string;
  readonly kind: XlsxColumnKind;
  /** Ancho en caracteres. */
  readonly width: number;
};
/** Texto, texto decimal, fecha ISO o momento; `null` deja la celda vacía. */
export type XlsxValue = string | Date | null;
export type XlsxSheet = {
  readonly name: string;
  readonly columns: readonly XlsxColumn[];
  readonly rows: AsyncIterable<readonly XlsxValue[]> | Iterable<readonly XlsxValue[]>;
};

/** Filas de una hoja de Excel, con la de encabezados. */
export const MAX_SHEET_ROWS = 1_048_576;
const MAX_SHEET_NAME = 31;
const CHUNK_CHARS = 64 * 1024;

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Índices de `cellXfs`. Los decimales tienen un estilo por cantidad de decimales, de 0 a 6.
const XF_HEADER = 1;
const XF_TEXT = 2;
const XF_DECIMAL_TEXT = 3;
const XF_DATE = 4;
const XF_DATE_TIME = 5;
const XF_DECIMAL = 6;
const decimalFormat = (decimals: number) =>
  decimals === 0 ? "#,##0" : `#,##0.${"0".repeat(decimals)}`;
const DECIMAL_STYLES = Array.from({ length: MAX_FORMAT_DECIMALS + 1 }, (_, decimals) => decimals);

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

const STYLES =
  `<styleSheet xmlns="${MAIN_NS}">` +
  `<numFmts count="${DECIMAL_STYLES.length + 2}">` +
  `<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>` +
  `<numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm:ss"/>` +
  DECIMAL_STYLES.map(
    (decimals) => `<numFmt numFmtId="${166 + decimals}" formatCode="${decimalFormat(decimals)}"/>`,
  ).join("") +
  `</numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="${XF_DECIMAL + DECIMAL_STYLES.length}">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" quotePrefix="1"/>` +
  `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/>` +
  `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1" quotePrefix="1"><alignment horizontal="right"/></xf>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  DECIMAL_STYLES.map(
    (decimals) =>
      `<xf numFmtId="${166 + decimals}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`,
  ).join("") +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function textCell(ref: string, style: number, text: string): string {
  if (text.length > MAX_CELL_TEXT)
    throw new XlsxValueError("El texto excede lo que admite una celda.");
  // xml:space solo con espacios en los bordes, como lo escribe Excel.
  const space = /^\s|\s$/.test(text) ? ` xml:space="preserve"` : "";
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${space}>${xmlText(text)}</t></is></c>`;
}

function cell(ref: string, kind: XlsxColumnKind, value: XlsxValue): string {
  if (value === null) return "";
  if (kind === "dateTime") {
    if (!(value instanceof Date)) throw new XlsxValueError("Se esperaba un momento.");
    return `<c r="${ref}" s="${XF_DATE_TIME}"><v>${dateTimeSerial(value)}</v></c>`;
  }
  if (typeof value !== "string") throw new XlsxValueError("Se esperaba un texto.");
  switch (kind) {
    case "text":
      return textCell(ref, XF_TEXT, value);
    case "date":
      return `<c r="${ref}" s="${XF_DATE}"><v>${dateSerial(value)}</v></c>`;
    case "money":
    case "decimal": {
      const number = numericValue(value, kind === "money" ? 2 : 0);
      // Más de 15 dígitos significativos: el texto exacto, nunca un número aproximado.
      if (!number) return textCell(ref, XF_DECIMAL_TEXT, value);
      return `<c r="${ref}" s="${XF_DECIMAL + number.decimals}"><v>${number.text}</v></c>`;
    }
  }
}

function sheetEntry(sheet: XlsxSheet, index: number, counts: number[]): ZipEntry {
  return {
    name: `xl/worksheets/sheet${index + 1}.xml`,
    chunks: async function* () {
      const refs = sheet.columns.map((_, column) => columnName(column));
      const widths = sheet.columns
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
        .join("");
      let buffer =
        XML_HEAD +
        `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
        `<sheetViews><sheetView workbookViewId="0">` +
        `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
        `</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
        `<cols>${widths}</cols><sheetData><row r="1">` +
        sheet.columns.map((c, i) => textCell(`${refs[i]}1`, XF_HEADER, c.header)).join("") +
        `</row>`;
      let row = 1;
      for await (const values of sheet.rows) {
        row += 1;
        if (row > MAX_SHEET_ROWS) throw new XlsxValueError("La hoja excede las filas de Excel.");
        if (values.length !== sheet.columns.length) {
          throw new XlsxValueError("La fila no tiene una celda por columna.");
        }
        buffer += `<row r="${row}">`;
        for (const [column, spec] of sheet.columns.entries()) {
          buffer += cell(`${refs[column]}${row}`, spec.kind, values[column] ?? null);
        }
        buffer += `</row>`;
        if (buffer.length >= CHUNK_CHARS) {
          yield buffer;
          buffer = "";
        }
      }
      yield buffer + `</sheetData></worksheet>`;
      counts[index] = row - 1;
    },
  };
}

function fixed(name: string, xml: string): ZipEntry {
  return { name, chunks: () => [XML_HEAD + xml] };
}

function checkSheets(sheets: readonly XlsxSheet[]): void {
  if (sheets.length === 0) throw new XlsxValueError("El libro necesita al menos una hoja.");
  const names = new Set<string>();
  for (const sheet of sheets) {
    const key = sheet.name.toLowerCase();
    if (
      sheet.name.length === 0 ||
      sheet.name.length > MAX_SHEET_NAME ||
      /[:\\/?*[\]]/.test(sheet.name) ||
      names.has(key)
    ) {
      throw new XlsxValueError("El nombre de la hoja no es válido.");
    }
    if (sheet.columns.length === 0) throw new XlsxValueError("La hoja necesita columnas.");
    names.add(key);
  }
}

/**
 * Escribe el libro en `path`, que no debe existir; lo crea con modo `0600`. Devuelve las filas de
 * datos de cada hoja. Si falla, el archivo puede quedar a medias: lo borra quien lo pidió.
 */
export async function writeXlsx(path: string, sheets: readonly XlsxSheet[]): Promise<number[]> {
  checkSheets(sheets);
  const counts = sheets.map(() => 0);
  const sheetIndexes = sheets.map((_, i) => i + 1);
  const entries: ZipEntry[] = [
    fixed(
      "[Content_Types].xml",
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheetIndexes
          .map(
            (n) =>
              `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        `</Types>`,
    ),
    fixed(
      "_rels/.rels",
      `<Relationships xmlns="${PKG_REL_NS}">` +
        `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ),
    fixed(
      "xl/workbook.xml",
      `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>` +
        sheets
          .map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("") +
        `</sheets></workbook>`,
    ),
    fixed(
      "xl/_rels/workbook.xml.rels",
      `<Relationships xmlns="${PKG_REL_NS}">` +
        sheetIndexes
          .map(
            (n) =>
              `<Relationship Id="rId${n}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${n}.xml"/>`,
          )
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ),
    fixed("xl/styles.xml", STYLES),
    ...sheets.map((sheet, index) => sheetEntry(sheet, index, counts)),
  ];
  await pipeline(
    Readable.from(zipBytes(entries)),
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
  );
  return counts;
}

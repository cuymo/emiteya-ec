// Lector de XLSX para las pruebas de los reportes (ADR 0023). Descomprime con fflate, una
// implementación independiente del escritor, comprueba el CRC-32 de cada entrada contra el
// directorio central y lee el XML con fast-xml-parser. Decodifica ST_Xstring como Excel.
import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";
// eslint-disable-next-line no-restricted-imports -- lector independiente de las pruebas del XLSX (ADR 0023)
import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";

export type XlsxCell = {
  readonly type: "string" | "number";
  /** El texto decodificado de la cadena, o el texto de `<v>` del número. */
  readonly text: string;
  readonly numFmt: string;
  readonly quotePrefix: boolean;
  readonly bold: boolean;
};
export type XlsxReadSheet = {
  readonly name: string;
  readonly frozenHeader: boolean;
  readonly widths: readonly number[];
  /** Filas por número; cada fila, sus celdas por referencia de columna ("A", "B"...). */
  readonly rows: ReadonlyMap<number, ReadonlyMap<string, XlsxCell>>;
};
export type XlsxBook = {
  readonly entries: readonly string[];
  /** El XML de cada parte, para buscar lo que nunca debe aparecer. */
  readonly parts: ReadonlyMap<string, string>;
  readonly sheets: readonly XlsxReadSheet[];
};

const BUILT_IN_FORMATS = new Map([
  ["0", "General"],
  ["49", "@"],
]);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (name) => ["row", "c", "xf", "numFmt", "sheet", "col", "font"].includes(name),
});

/** ST_Xstring (ECMA-376 Parte 1, §22.9.2.19). */
export const decodeXstring = (text: string) =>
  text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

type Node = Record<string, unknown>;
const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "object" && value !== null
      ? text((value as Node)["#text"])
      : "";

/** CRC y nombre de cada entrada según el directorio central. */
function centralDirectory(zip: Buffer): Map<string, number> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("ZIP sin cierre del directorio central");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries = new Map<string, number>();
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error("Directorio central inválido");
    const nameLength = zip.readUInt16LE(offset + 28);
    const extra = zip.readUInt16LE(offset + 30);
    const comment = zip.readUInt16LE(offset + 32);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, zip.readUInt32LE(offset + 16));
    offset += 46 + nameLength + extra + comment;
  }
  return entries;
}

export function readXlsx(path: string): XlsxBook {
  const zip = readFileSync(path);
  const files = unzipSync(zip);
  const crcs = centralDirectory(zip);
  for (const [name, bytes] of Object.entries(files)) {
    if (crcs.get(name) !== crc32(bytes)) throw new Error(`CRC distinto en ${name}`);
  }
  const parts = new Map(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
  const xml = (name: string) => {
    const part = parts.get(name);
    if (part === undefined) throw new Error(`Falta la parte ${name}`);
    return parser.parse(part) as Node;
  };

  const styles = xml("xl/styles.xml").styleSheet as Node;
  const formats = new Map(BUILT_IN_FORMATS);
  for (const format of ((styles.numFmts as Node | undefined)?.numFmt ?? []) as Node[]) {
    formats.set(String(format.numFmtId), String(format.formatCode));
  }
  const fonts = ((styles.fonts as Node).font as Node[]).map((font) => "b" in font);
  const xfs = ((styles.cellXfs as Node).xf as Node[]).map((xf) => ({
    numFmt: formats.get(String(xf.numFmtId)) ?? `#${String(xf.numFmtId)}`,
    quotePrefix: xf.quotePrefix === "1",
    bold: fonts[Number(xf.fontId)] ?? false,
  }));

  const workbook = xml("xl/workbook.xml").workbook as Node;
  const sheets = ((workbook.sheets as Node).sheet as Node[]).map((sheet, index): XlsxReadSheet => {
    const worksheet = xml(`xl/worksheets/sheet${index + 1}.xml`).worksheet as Node;
    const view = ((worksheet.sheetViews as Node | undefined)?.sheetView ?? {}) as Node;
    const rows = new Map<number, Map<string, XlsxCell>>();
    for (const row of ((worksheet.sheetData as Node).row ?? []) as Node[]) {
      const cells = new Map<string, XlsxCell>();
      for (const c of (row.c ?? []) as Node[]) {
        if ("f" in c) throw new Error(`Fórmula en ${String(c.r)}`);
        const style = xfs[Number(c.s ?? 0)]!;
        const isString = c.t === "inlineStr";
        if (!isString && c.t !== undefined)
          throw new Error(`Tipo inesperado ${JSON.stringify(c.t)}`);
        cells.set(String(c.r).replace(/\d+$/, ""), {
          type: isString ? "string" : "number",
          text: isString ? decodeXstring(text((c.is as Node).t)) : text(c.v),
          ...style,
        });
      }
      rows.set(Number(row.r), cells);
    }
    return {
      name: String(sheet.name),
      frozenHeader: (view.pane as Node | undefined)?.state === "frozen",
      widths: (((worksheet.cols as Node | undefined)?.col ?? []) as Node[]).map((col) =>
        Number(col.width),
      ),
      rows,
    };
  });
  return { entries: Object.keys(files), parts, sheets };
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** El momento de reloj (sin zona) de un serial de Excel, como `AAAA-MM-DDTHH:MM:SS.mmm`. */
export function serialToWallClock(serial: string): string {
  return new Date(Math.round(Number(serial) * 86_400_000) + EXCEL_EPOCH).toISOString().slice(0, 23);
}

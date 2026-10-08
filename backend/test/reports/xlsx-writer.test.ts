// Escritor XLSX de los reportes (ADR 0023; design D6, D7 y D8 de add-reports-export). Cada libro se
// lee con un lector independiente: tipos y valores exactos de cada celda, decimales que vuelven al
// mismo valor desde un double, textos que nunca son fórmulas, fechas sin desplazamiento en otra zona
// horaria, bytes deterministas y memoria acotada con 100 000 filas.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Decimal } from "decimal.js";
import { afterAll, describe, expect, it } from "vitest";
import {
  dateSerial,
  dateTimeSerial,
  XlsxValueError,
} from "../../src/modules/reports/infrastructure/xlsx/cells.ts";
import {
  writeXlsx,
  type XlsxColumn,
  type XlsxSheet,
  type XlsxValue,
} from "../../src/modules/reports/infrastructure/xlsx/xlsx-writer.ts";
import { fixtureRow, fixtureSheets } from "../support/xlsx-fixture.ts";
import { readXlsx, serialToWallClock, type XlsxCell } from "../support/xlsx-reader.ts";

const run = promisify(execFile);
const dir = mkdtempSync(join(tmpdir(), "xlsx-writer-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let next = 0;
const target = () => join(dir, `libro-${(next += 1)}.xlsx`);

/** Escribe una hoja de una columna con esos valores y devuelve sus celdas de datos en orden. */
async function column(
  kind: XlsxColumn["kind"],
  values: XlsxValue[],
): Promise<(XlsxCell | undefined)[]> {
  const path = target();
  await writeXlsx(path, [
    {
      name: "Datos",
      columns: [{ header: "Valor", kind, width: 20 }],
      rows: values.map((v) => [v]),
    },
  ]);
  const sheet = readXlsx(path).sheets[0]!;
  return values.map((_, i) => sheet.rows.get(i + 2)?.get("A"));
}

describe("paquete", () => {
  it("escribe un ZIP válido con las partes mínimas, hojas en orden y sin fórmulas", async () => {
    const path = target();
    const counts = await writeXlsx(path, fixtureSheets(30));
    const book = readXlsx(path);
    expect(counts).toEqual([30, 2]);
    expect(book.entries).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
    expect(book.sheets.map((s) => s.name)).toEqual(["Documentos emitidos", "Filtros"]);
    for (const [name, xml] of book.parts) {
      expect(xml, name).not.toMatch(/<f[\s>/]/);
      expect(xml, name).not.toMatch(/sharedStrings|<si>/);
    }
    const data = book.sheets[0]!;
    expect(data.frozenHeader).toBe(true);
    expect(data.widths).toEqual([11, 18, 16, 40, 14, 16, 20]);
    expect(data.rows.size).toBe(31);
    const header = [...data.rows.get(1)!.values()];
    expect(header.map((c) => c.text)).toEqual([
      "Fecha",
      "Número",
      "Identificación",
      "Tercero",
      "Total",
      "Cantidad",
      "Momento",
    ]);
    expect(header.every((c) => c.type === "string" && c.bold)).toBe(true);
    const filters = book.sheets[1]!;
    expect(filters.rows.get(3)?.get("B")?.text).toBe("01/09/2026");
  });

  it("crea el archivo con modo 0600 y nunca reemplaza uno existente", async () => {
    const path = target();
    await writeXlsx(path, fixtureSheets(1));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const existing = target();
    writeFileSync(existing, "previo");
    await expect(writeXlsx(existing, fixtureSheets(1))).rejects.toMatchObject({ code: "EEXIST" });
    expect(readFileSync(existing, "utf8")).toBe("previo");
  });

  it("escribe solo los encabezados de una hoja sin filas", async () => {
    const path = target();
    expect(await writeXlsx(path, fixtureSheets(0))).toEqual([0, 2]);
    const sheet = readXlsx(path).sheets[0]!;
    expect([...sheet.rows.keys()]).toEqual([1]);
  });

  it("da los mismos bytes con las mismas filas", async () => {
    const [a, b] = [target(), target()];
    await writeXlsx(a, fixtureSheets(500));
    await writeXlsx(b, fixtureSheets(500));
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
  });

  it("rechaza nombres de hoja inválidos o repetidos y filas incompletas", async () => {
    const sheet = (name: string, rows: XlsxValue[][] = []): XlsxSheet => ({
      name,
      columns: [{ header: "A", kind: "text", width: 10 }],
      rows,
    });
    for (const sheets of [
      [sheet("")],
      [sheet("x".repeat(32))],
      [sheet("a/b")],
      [sheet("Datos"), sheet("datos")],
      [],
    ]) {
      await expect(writeXlsx(target(), sheets)).rejects.toBeInstanceOf(XlsxValueError);
    }
    await expect(writeXlsx(target(), [sheet("Datos", [["a", "b"]])])).rejects.toBeInstanceOf(
      XlsxValueError,
    );
  });

  it("falla con el error de la fuente de filas", async () => {
    function* failing() {
      yield fixtureRow(0);
      throw new Error("lectura interrumpida");
    }
    const sheets = [{ name: "Datos", columns: fixtureSheets(0)[0]!.columns, rows: failing() }];
    await expect(writeXlsx(target(), sheets)).rejects.toThrow("lectura interrumpida");
  });
});

describe("texto", () => {
  it("conserva la identificación con su cero a la izquierda como texto", async () => {
    const [cell] = await column("text", ["0102030405"]);
    expect(cell).toMatchObject({
      type: "string",
      text: "0102030405",
      numFmt: "@",
      quotePrefix: true,
    });
  });

  it("escribe como cadena, intacto y con quotePrefix todo lo que parece una fórmula", async () => {
    const hostile = [
      "=1+1",
      "+CMD|' /C calc'!A0",
      "-1+1",
      "@SUM(A1:A2)",
      "\t=1+1",
      "\r=1+1",
      " =1+1",
      "  +1",
      "\t -1",
      " @SUM(A1)",
      '=HYPERLINK("http://ejemplo.invalid","x")',
    ];
    const cells = await column("text", hostile);
    expect(cells.map((c) => c?.text)).toEqual(hostile);
    expect(cells.every((c) => c?.type === "string" && c.quotePrefix)).toBe(true);
  });

  it("no descarta ni cambia caracteres de control, escapes literales ni símbolos", async () => {
    const values = [
      "ctrl\u0001\u000B\u001F\u007F",
      "_x0041_ literal",
      "multi\nlínea\r\nCRLF",
      'Ñandú & <b>negrita</b> "comillas"',
      "emoji 🧾 𝔘",
      "espacio final ",
      "",
    ];
    const cells = await column("text", values);
    expect(cells.map((c) => c?.text)).toEqual(values);
  });

  it("rechaza un texto más largo que una celda en lugar de cortarlo", async () => {
    await expect(column("text", ["x".repeat(32_768)])).rejects.toBeInstanceOf(XlsxValueError);
  });
});

/** Lo que mostraría cualquier lector que pase el número a double y lo imprima con 15 dígitos. */
const throughDouble = (text: string) => new Decimal(Number(text).toPrecision(15));

describe("decimales", () => {
  it("escribe los importes como números exactos con formato monetario", async () => {
    const values = [
      "0.10",
      "100.29",
      "106.00",
      "-0.01",
      "0.00",
      "999999999999.99",
      "9999999999999.99",
    ];
    const cells = await column("money", values);
    expect(cells.map((c) => c?.type)).toEqual(values.map(() => "number"));
    expect(cells.map((c) => c?.text)).toEqual([
      "0.1",
      "100.29",
      "106",
      "-0.01",
      "0",
      "999999999999.99",
      "9999999999999.99",
    ]);
    expect(cells.every((c) => c?.numFmt === "#,##0.00")).toBe(true);
    for (const [i, value] of values.entries()) {
      expect(throughDouble(cells[i]!.text).equals(new Decimal(value)), value).toBe(true);
      expect(String(Number(cells[i]!.text))).toBe(cells[i]!.text);
    }
  });

  it("muestra las cantidades y los porcentajes con los decimales de su valor", async () => {
    const values = ["2.5", "1234.567891", "5", "15.00", "1.75", "0.000001", "123456789.123456"];
    const cells = await column("decimal", values);
    expect(cells.map((c) => [c?.type, c?.text, c?.numFmt])).toEqual([
      ["number", "2.5", "#,##0.0"],
      ["number", "1234.567891", "#,##0.000000"],
      ["number", "5", "#,##0"],
      ["number", "15", "#,##0"],
      ["number", "1.75", "#,##0.00"],
      ["number", "0.000001", "#,##0.000000"],
      ["number", "123456789.123456", "#,##0.000000"],
    ]);
    for (const [i, value] of values.entries()) {
      expect(throughDouble(cells[i]!.text).equals(new Decimal(value)), value).toBe(true);
    }
  });

  it("escribe como texto exacto lo que excede 15 dígitos significativos o 6 decimales", async () => {
    const values = [
      "99999999999999.99",
      "12345678901234567890.12",
      "999999999999.999999",
      "999999999999999999999999.999999",
      "1.0000001",
    ];
    for (const kind of ["money", "decimal"] as const) {
      const cells = await column(kind, values);
      expect(cells.map((c) => [c?.type, c?.text])).toEqual(values.map((v) => ["string", v]));
      expect(cells.every((c) => c?.quotePrefix)).toBe(true);
    }
  });

  it("deja vacía la celda de un importe que no existe, sin inventar un cero", async () => {
    const [cell] = await column("money", [null]);
    expect(cell).toBeUndefined();
  });

  it("rechaza un valor que no es un decimal canónico", async () => {
    for (const value of ["1e5", "1,5", " 1", "-0", "abc"]) {
      await expect(column("money", [value])).rejects.toBeInstanceOf(XlsxValueError);
    }
  });
});

describe("fechas y momentos", () => {
  it("calcula el serial de Excel de una fecha sin zona horaria", () => {
    expect(dateSerial("2024-01-01")).toBe("45292");
    expect(dateSerial("2000-02-29")).toBe("36585");
    expect(dateSerial("1990-01-01")).toBe("32874");
    expect(dateSerial("2026-10-07")).toBe("46302");
    for (const invalid of ["2026-02-30", "2026-9-1", "1899-12-31", "07/10/2026"]) {
      expect(() => dateSerial(invalid)).toThrow(XlsxValueError);
    }
  });

  it("escribe la fecha de emisión como fecha que vale ese mismo día", async () => {
    const [cell] = await column("date", ["2026-10-07"]);
    expect(cell).toMatchObject({ type: "number", numFmt: "dd/mm/yyyy" });
    expect(serialToWallClock(cell!.text)).toBe("2026-10-07T00:00:00.000");
  });

  it("escribe los momentos con la hora de Ecuador y sus milisegundos", async () => {
    const moments = [
      "2026-09-01T05:00:00.000Z",
      "2026-09-01T04:59:59.999Z",
      "2026-10-01T04:00:00.001Z",
    ];
    expect(dateTimeSerial(new Date(moments[0]!))).toBe("46266");
    const cells = await column(
      "dateTime",
      moments.map((m) => new Date(m)),
    );
    expect(cells.every((c) => c?.type === "number" && c.numFmt === "dd/mm/yyyy hh:mm:ss")).toBe(
      true,
    );
    expect(cells.map((c) => serialToWallClock(c!.text))).toEqual([
      "2026-09-01T00:00:00.000",
      "2026-08-31T23:59:59.999",
      "2026-09-30T23:00:00.001",
    ]);
  });

  it("da los mismos bytes y las mismas fechas en procesos con otra zona horaria", async () => {
    const local = target();
    await writeXlsx(local, fixtureSheets(200));
    for (const TZ of ["Pacific/Kiritimati", "America/Los_Angeles", "UTC"]) {
      const path = target();
      await run(
        process.execPath,
        ["--conditions=development", "test/support/xlsx-probe.ts", path, "200"],
        { env: { ...process.env, TZ, LC_ALL: "C", LANG: "C" } },
      );
      expect(readFileSync(path).equals(readFileSync(local)), TZ).toBe(true);
    }
    const row = readXlsx(local).sheets[0]!.rows.get(2)!;
    expect(serialToWallClock(row.get("A")!.text)).toBe("2026-10-07T00:00:00.000");
    expect(serialToWallClock(row.get("G")!.text)).toBe("2026-08-31T23:59:59.999");
  });
});

const HEAP_LIMIT_MIB = 24;

describe("memoria", () => {
  it("escribe 100 000 filas por streaming sin retener el libro", async () => {
    const path = target();
    const { stdout } = await run(process.execPath, [
      "--conditions=development",
      `--max-old-space-size=${HEAP_LIMIT_MIB}`,
      "test/support/xlsx-probe.ts",
      path,
      "100000",
    ]);
    const probe = JSON.parse(stdout) as {
      counts: number[];
      peakHeap: number;
      peakExternal: number;
    };
    expect(probe.counts).toEqual([100_000, 2]);
    const book = readXlsx(path);
    const sheetBytes = Buffer.byteLength(book.parts.get("xl/worksheets/sheet1.xml")!);
    expect(book.sheets[0]!.rows.size).toBe(100_001);
    // La hoja sin comprimir no cabe en el heap del proceso que la escribió, y fuera del heap el
    // proceso tuvo menos que eso.
    expect(sheetBytes).toBeGreaterThan(32 * 2 ** 20);
    expect(probe.peakHeap).toBeLessThan(sheetBytes);
    expect(probe.peakExternal).toBeLessThan(HEAP_LIMIT_MIB * 2 ** 20);
  });
});

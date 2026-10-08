// Exportación de los reportes por HTTP (add-reports-export, tarea 4.3, design D10, D11, D13 y D15):
// AC-09 en cada reporte (todas las páginas de la API son exactamente las filas del XLSX), el libro
// vacío, las cabeceras, el `409` sin archivo ni evento, el `503` con `Retry-After` sin afectar a la
// exportación en curso, el evento con los filtros sin datos personales, ningún evento ante un
// rechazo o un fallo, dos exportaciones con dos eventos, el temporal siempre borrado (también si el
// cliente se desconecta), `HEAD`, `401`, `403` y el aislamiento por empresa.
import { writeFile } from "node:fs/promises";
import { get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Decimal } from "decimal.js";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { REPORT_IDS, type ReportId, type ReportListMeta } from "@facturador/contracts";
import { REPORT_DEFINITIONS } from "../../src/modules/reports/domain/definitions.ts";
import type { XlsxWriter } from "../../src/modules/reports/application/ports.ts";
import { writeXlsx } from "../../src/modules/reports/infrastructure/xlsx/xlsx-writer.ts";
import { readXlsx, serialToWallClock, type XlsxBook } from "../support/xlsx-reader.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { deferred } from "./fiscal-harness.ts";
import {
  binary,
  buildReportsApp,
  exportEvents,
  seededCompany,
  type SeededCompany,
} from "./reports-api-harness.ts";

type Page = { data: Record<string, unknown>[]; meta: ReportListMeta };
type App = ReturnType<typeof buildReportsApp>;

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
function expectSameRows(report: ReportId, rows: Record<string, unknown>[], book: XlsxBook) {
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

describe("exportación de los reportes por HTTP", () => {
  let db: MigratedSchema;
  let api: App;
  let a: SeededCompany;
  let b: SeededCompany;

  const exportOf = (
    app: App,
    report: ReportId,
    query: Record<string, string> = {},
    cookie: string | null = a.cookies.operator,
  ) => {
    const call = request(app.app)
      .get(`/api/v1/reports/${report}/export`)
      .query(query)
      .buffer(true)
      .parse(binary);
    return cookie ? call.set("Cookie", cookie) : call;
  };

  async function allRows(report: ReportId, query: Record<string, string>, company: SeededCompany) {
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; ; page += 1) {
      const res = await request(api.app)
        .get(`/api/v1/reports/${report}`)
        .query({ ...query, page: String(page), pageSize: "2" })
        .set("Cookie", company.cookies.admin);
      expect(res.status).toBe(200);
      const body = res.body as Page;
      rows.push(...body.data);
      if (rows.length >= body.meta.total) return rows;
    }
  }

  const noLeftovers = (app: App) => vi.waitFor(() => expect(app.leftovers()).toEqual([]));

  beforeAll(async () => {
    db = await createMigratedSchema("report_exports_api");
    api = buildReportsApp(db);
    a = await seededCompany(db, api, "Exportaciones A");
    b = await seededCompany(db, api, "Exportaciones B");
  }, 300_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("AC-09: cada reporte exporta exactamente las filas de todas sus páginas, en el mismo orden", async () => {
    const cases: [ReportId, Record<string, string>][] = [
      ...REPORT_IDS.map((report): [ReportId, Record<string, string>] => [report, {}]),
      ["issued-documents", { from: "2026-09-01", to: "2026-09-30", environment: "ALL" }],
      ["invoices", { state: "ALL" }],
      ["withholdings", { state: "ALL", fiscalPeriod: "2026-09" }],
      ["inventory-movements", { productId: a.ids.product! }],
      ["parties", { status: "ALL" }],
    ];
    for (const [report, query] of cases) {
      const rows = await allRows(report, query, a);
      expect(rows.length, report).toBeGreaterThan(0);
      const res = await exportOf(api, report, query);
      expect([report, res.status]).toEqual([report, 200]);
      const book = readXlsx(res.body as Buffer);
      expectSameRows(report, rows, book);
      expect(book.sheets.map((sheet) => sheet.name)).toEqual([
        REPORT_DEFINITIONS[report].label,
        "Filtros",
      ]);
      for (const [name, xml] of book.parts) expect(xml, name).not.toMatch(/<f[\s>/]/);
    }
    await noLeftovers(api);
  });

  it("entrega un adjunto privado con un nombre ASCII sin datos personales", async () => {
    const res = await exportOf(api, "invoices", {
      from: "2026-09-01",
      to: "2026-09-30",
      customerIdentification: a.ids.customer!,
    });
    expect(res.status).toBe(200);
    expect(res.headers).toMatchObject({
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": 'attachment; filename="facturas-2026-09-01-2026-09-30.xlsx"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    expect(Number(res.headers["content-length"])).toBe((res.body as Buffer).length);
    const filters = readXlsx(res.body as Buffer).sheets[1]!;
    const pairs = [...filters.rows.values()].map((row) =>
      [...row.values()].map((cell) => cell.text),
    );
    expect(pairs).toEqual(
      expect.arrayContaining([
        ["Reporte", "Facturas"],
        ["Desde", "01/09/2026"],
        ["Identificación del cliente", a.ids.customer],
        ["Estado", "Autorizado"],
        ["Ambiente", "Pruebas"],
        ["Filas", "1"],
        ["Aviso", "Los reportes no reemplazan obligaciones contables ni anexos tributarios."],
      ]),
    );
    await noLeftovers(api);
  });

  it("exporta un libro con solo los encabezados si no hay resultados", async () => {
    const res = await exportOf(api, "issued-documents", { from: "2025-01-01", to: "2025-01-31" });
    expect(res.status).toBe(200);
    const sheet = readXlsx(res.body as Buffer).sheets[0]!;
    expect([...sheet.rows.keys()]).toEqual([1]);
  });

  it("audita cada exportación con los filtros sin datos personales y solo su presencia", async () => {
    const before = (await exportEvents(db, a.companyId)).length;
    for (let time = 0; time < 2; time += 1) {
      const res = await exportOf(api, "invoices", { customerIdentification: a.ids.customer! });
      expect(res.status).toBe(200);
    }
    const events = await exportEvents(db, a.companyId);
    expect(events.length).toBe(before + 2);
    const [latest] = events;
    expect(latest).toMatchObject({
      actor: { type: "USER", userId: a.operatorId },
      changes: {
        report: "invoices",
        rows: 1,
        state: "AUTHORIZED",
        environment: "TEST",
        customerIdentificationPresent: true,
      },
    });
    const serialized = JSON.stringify(latest);
    expect(serialized).not.toContain(a.ids.customer);
    expect(serialized).not.toMatch(/HYPERLINK|\.xlsx|facturador-report/);
  });

  it("rechaza con 409 lo que supera el máximo de filas, sin archivo ni evento", async () => {
    const limited = buildReportsApp(db, { maxRows: 2 });
    const before = (await exportEvents(db, a.companyId)).length;
    const res = await exportOf(limited, "issued-documents");
    expect(res.status).toBe(409);
    expect(JSON.parse((res.body as Buffer).toString("utf8"))).toMatchObject({
      error: { code: "REPORT_EXPORT_ROW_LIMIT" },
    });
    expect(limited.leftovers()).toEqual([]);
    expect((await exportEvents(db, a.companyId)).length).toBe(before);
    expect(await limited.metrics.metrics()).toMatch(
      /report_exports_total\{report="issued-documents",result="row_limit"\} 1/,
    );
    // La lista no tiene ese límite.
    const listed = await request(limited.app)
      .get("/api/v1/reports/issued-documents")
      .set("Cookie", a.cookies.operator);
    expect((listed.body as Page).meta.total).toBeGreaterThan(2);
  });

  it("responde 503 con Retry-After sin afectar a la exportación en curso", async () => {
    const entered = deferred();
    const release = deferred();
    const writer: XlsxWriter = async (path, sheets) => {
      entered.resolve();
      await release.promise;
      return writeXlsx(path, sheets);
    };
    const busy = buildReportsApp(db, { maxConcurrent: 1, writer });
    const before = (await exportEvents(db, a.companyId)).length;
    const first = exportOf(busy, "parties").then((res) => res);
    await entered.promise;
    const second = await exportOf(busy, "invoices");
    expect(second.status).toBe(503);
    expect(second.headers["retry-after"]).toBe("15");
    expect(JSON.parse((second.body as Buffer).toString("utf8"))).toMatchObject({
      error: { code: "REPORT_EXPORT_BUSY" },
    });
    release.resolve();
    const done = await first;
    expect(done.status).toBe(200);
    expectSameRows("parties", await allRows("parties", {}, a), readXlsx(done.body as Buffer));
    expect((await exportEvents(db, a.companyId)).length).toBe(before + 1);
    expect(await busy.metrics.metrics()).toMatch(
      /report_exports_total\{report="invoices",result="busy"\} 1/,
    );
    await noLeftovers(busy);
  });

  it("no audita ni deja el temporal si falla la generación o la auditoría", async () => {
    const before = (await exportEvents(db, a.companyId)).length;
    const failingWriter = buildReportsApp(db, {
      writer: async (path) => {
        await writeFile(path, "a medias");
        throw new Error("disco lleno");
      },
    });
    const failed = await exportOf(failingWriter, "issued-documents");
    expect(failed.status).toBe(500);
    expect(failingWriter.leftovers()).toEqual([]);
    const failingAudit = buildReportsApp(db, {
      audit: () => ({ append: () => Promise.reject(new Error("auditoría caída")) }),
    });
    const unaudited = await exportOf(failingAudit, "issued-documents");
    expect(unaudited.status).toBe(500);
    expect(unaudited.headers["content-disposition"]).toBeUndefined();
    expect(failingAudit.leftovers()).toEqual([]);
    expect((await exportEvents(db, a.companyId)).length).toBe(before);
    expect(await failingAudit.metrics.metrics()).toMatch(
      /report_exports_total\{report="issued-documents",result="failed"\} 1/,
    );
  });

  it("detiene la generación y borra el temporal si el cliente se desconecta", async () => {
    const entered = deferred();
    const release = deferred();
    const writer: XlsxWriter = async (path, sheets) => {
      entered.resolve();
      await release.promise;
      return writeXlsx(path, sheets);
    };
    const disconnected = buildReportsApp(db, { maxConcurrent: 1, writer });
    const before = (await exportEvents(db, a.companyId)).length;
    const server: Server = disconnected.app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const client = get({
        port,
        path: "/api/v1/reports/issued-documents/export",
        headers: { Cookie: a.cookies.operator },
      });
      client.on("error", () => undefined);
      await entered.promise;
      client.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));
      release.resolve();
      await noLeftovers(disconnected);
      await vi.waitFor(async () =>
        expect(await disconnected.metrics.metrics()).toMatch(
          /report_exports_total\{report="issued-documents",result="failed"\} 1/,
        ),
      );
    } finally {
      server.close();
    }
    expect((await exportEvents(db, a.companyId)).length).toBe(before);
  });

  it("no genera nada con HEAD, sin sesión ni sin permiso", async () => {
    const before = (await exportEvents(db, a.companyId)).length;
    const head = await request(api.app)
      .head("/api/v1/reports/parties/export")
      .set("Cookie", a.cookies.operator);
    expect(head.status).toBe(405);
    expect((await exportOf(api, "parties", {}, null)).status).toBe(401);
    const denied = buildReportsApp(db, { denyReports: true });
    expect((await exportOf(denied, "parties")).status).toBe(403);
    expect((await exportOf(api, "parties", { companyId: b.companyId })).status).toBe(400);
    expect((await exportOf(api, "parties", { page: "2" })).status).toBe(400);
    expect((await exportEvents(db, a.companyId)).length).toBe(before);
    expect(api.leftovers()).toEqual([]);
  });

  it("exporta solo los datos de la empresa de la sesión", async () => {
    const res = await exportOf(api, "parties", { status: "ALL" }, b.cookies.operator);
    expect(res.status).toBe(200);
    const book = readXlsx(res.body as Buffer);
    expectSameRows("parties", await allRows("parties", { status: "ALL" }, b), book);
    const text = [...book.parts.values()].join("");
    expect(text).toContain(b.ids.customer);
    expect(text).not.toContain(a.ids.customer);
    expect(text).not.toContain(a.ids.supplier);
  });
});

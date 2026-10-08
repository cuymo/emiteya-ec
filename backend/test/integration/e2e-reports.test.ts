// Prueba end-to-end de add-reports-export (tarea 6.3) contra el backend real: main.ts como proceso,
// sin firma ni transmisión, sobre una instalación nueva con comprobantes sintéticos de los seis tipos
// en los dos ambientes, retenciones, inventario y terceros. Exporta cada reporte por HTTP, lee el
// XLSX y lo compara con todas las páginas de la API, comprueba cada evento `report.exported` y que
// los comprobantes, las retenciones, el inventario y los terceros no cambian.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReportId, ReportListMeta } from "@facturador/contracts";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { readXlsx } from "../support/xlsx-reader.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { E2E_ORIGIN, startE2eBackend, type E2eBackend } from "./e2e-backend.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { seedReportData } from "./reports-api-harness.ts";
import { expectSameRows } from "./reports-xlsx-assertions.ts";

const ADMIN = { email: "admin@e2e-reportes.ec", password: "contrasena-admin-e2e-1" };
const OPERATOR = { email: "operador@e2e-reportes.ec", password: "contrasena-operador-e2e-1" };
/** Tablas que los reportes leen y que nunca deben cambiar al consultarlos o exportarlos. */
const READ_TABLES = [
  "electronic_document",
  "electronic_document_recipient",
  "withholding_receipt",
  "withholding_receipt_line",
  "stock_balance",
  "stock_movement",
  "party",
  "product",
];

describe("flujo completo de los reportes", () => {
  let db: MigratedSchema;
  let backend: E2eBackend;
  let operator: string;
  let companyId: string;
  let operatorId: string;
  let ids: Record<string, string>;

  const api = async (path: string, cookie = operator) => {
    const res = await backend.fetchApi("GET", path, cookie);
    expect([path, res.status]).toEqual([path, 200]);
    return res;
  };

  /** Huella de cada tabla leída: su número de filas y el hash de su contenido. */
  async function fingerprints() {
    const prisma = db.database.prisma;
    const result: Record<string, string> = {};
    for (const table of READ_TABLES) {
      const [row] = await prisma.$queryRawUnsafe<{ count: bigint; hash: string | null }[]>(
        `SELECT count(*) AS count, md5(string_agg(t::text, '|' ORDER BY t::text)) AS hash FROM "${db.name}"."${table}" t`,
      );
      result[table] = `${row!.count}:${row!.hash ?? ""}`;
    }
    return result;
  }

  async function allPages(report: ReportId, query: string) {
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; ; page += 1) {
      const res = await api(
        `/reports/${report}?${query}${query ? "&" : ""}page=${page}&pageSize=4`,
      );
      const body = (await res.json()) as { data: Record<string, unknown>[]; meta: ReportListMeta };
      rows.push(...body.data);
      if (rows.length >= body.meta.total) return rows;
    }
  }

  beforeAll(async () => {
    db = await createMigratedSchema("end_to_end_reports");
    backend = await startE2eBackend({
      label: "end_to_end_reports",
      admin: ADMIN,
      db,
      env: { RIDE_SWEEP_INTERVAL_SECONDS: "86400" },
    });
    const admin = (await backend.signIn(ADMIN.email, ADMIN.password)).cookie;
    const send = async (method: string, path: string, body: unknown) => {
      const res = await backend.fetchApi(method, path, admin, body);
      expect([path, res.status]).toEqual([path, method === "POST" ? 201 : 200]);
      return ((await res.json()) as { data: { id: string } }).data;
    };
    await send("PUT", "/taxpayer", {
      ruc: "1790012345001",
      legalName: "COMERCIAL ANDINA S.A.",
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      accountingRequired: true,
      expectedVersion: null,
    });
    const points: FiscalCompany["points"] = [];
    for (const code of ["001", "002"]) {
      const establishment = await send("POST", "/establishments", {
        code,
        address: `Calle ${code}`,
      });
      const point = await send("POST", `/establishments/${establishment.id}/emission-points`, {
        code: "001",
      });
      points.push({ establishmentId: establishment.id, emissionPointId: point.id, code });
    }
    operatorId = (
      await send("POST", "/users", {
        name: "Olga Operadora",
        email: OPERATOR.email,
        password: OPERATOR.password,
        role: "OPERATOR",
      })
    ).id;
    operator = (await backend.signIn(OPERATOR.email, OPERATOR.password)).cookie;
    const prisma = db.database.prisma;
    const user = await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } });
    companyId = (await prisma.member.findFirstOrThrow({ where: { userId: user.id } }))
      .organizationId;
    ids = await seedReportData(prisma, { companyId, adminId: user.id, points });
  }, 300_000);

  afterAll(async () => {
    await backend?.stop();
    await db?.drop();
  });

  it("cada reporte exporta exactamente las filas de todas sus páginas, sin cambiar los datos", async () => {
    const before = await fingerprints();
    const cases: [ReportId, string][] = [
      ["issued-documents", ""],
      ["issued-documents", "environment=ALL"],
      ["issued-documents", "from=2026-09-01&to=2026-09-30&state=AUTHORIZED"],
      ["invoices", "state=ALL"],
      ["withholdings", "state=ALL"],
      ["inventory-balances", ""],
      ["inventory-movements", ""],
      ["parties", "status=ALL"],
    ];
    for (const [report, query] of cases) {
      const rows = await allPages(report, query);
      expect([report, query, rows.length > 0]).toEqual([report, query, true]);
      const res = await fetch(
        `${backend.base}/api/v1/reports/${report}/export${query ? `?${query}` : ""}`,
        { headers: { cookie: operator, origin: E2E_ORIGIN } },
      );
      expect([report, res.status]).toEqual([report, 200]);
      expect(res.headers.get("content-type")).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-disposition")).toMatch(
        /^attachment; filename="[a-z0-9-]+\.xlsx"$/,
      );
      const book = readXlsx(new Uint8Array(await res.arrayBuffer()));
      expectSameRows(report, rows, book);
      for (const [name, xml] of book.parts) expect(xml, name).not.toMatch(/<f[\s>/]/);
    }
    // Los dos ambientes por defecto: el vigente (Pruebas) nunca mezcla el de Producción.
    const testOnly = await allPages("issued-documents", "");
    expect(testOnly.map((row) => row.id)).not.toContain(ids.productionInvoice);
    expect((await allPages("issued-documents", "environment=ALL")).map((row) => row.id)).toContain(
      ids.productionInvoice,
    );

    const events = (await createAuditLog(db.database.prisma).listForCompany(companyId)).filter(
      (event) => event.action === "report.exported",
    );
    expect(events).toHaveLength(cases.length);
    expect(
      events.every((event) => event.actor.type === "USER" && event.actor.userId === operatorId),
    ).toBe(true);
    expect(events.map((event) => event.changes?.report).sort()).toEqual(
      cases.map(([report]) => report).sort(),
    );
    expect(await fingerprints()).toEqual(before);
  });
});

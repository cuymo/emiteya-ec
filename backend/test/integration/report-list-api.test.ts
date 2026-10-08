// Lista paginada de los reportes por HTTP (add-reports-export, tarea 4.2, design D3, D4, D12 y D14):
// las filas y `meta.total` de cada reporte, el ambiente efectivo (el vigente por defecto y `ALL`
// solo explícito), los estados por defecto, `401`, `403`, el `companyId` y el filtro de otro reporte
// rechazados, el aislamiento por empresa y ningún evento de auditoría por consultar.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPORT_IDS, type ReportId, type ReportListMeta } from "@facturador/contracts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import { createTaxpayerConfiguration } from "../../src/modules/taxpayer/application/taxpayer-configuration.ts";
import { createCompanyConfigRepository } from "../../src/modules/taxpayer/infrastructure/prisma-company-config.ts";
import { createTaxpayerUnitOfWork } from "../../src/modules/taxpayer/infrastructure/unit-of-work.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  buildReportsApp,
  exportEvents,
  seededCompany,
  type SeededCompany,
} from "./reports-api-harness.ts";

type Page = { data: Record<string, unknown>[]; meta: ReportListMeta };

describe("lista de los reportes por HTTP", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildReportsApp>;
  let a: SeededCompany;
  let b: SeededCompany;

  const list = (
    report: ReportId,
    query: Record<string, string> = {},
    cookie: string | null = a.cookies.operator,
  ) => {
    const call = request(api.app).get(`/api/v1/reports/${report}`).query(query);
    return cookie ? call.set("Cookie", cookie) : call;
  };

  /** Todas las páginas de un reporte por HTTP, concatenadas. */
  async function allRows(report: ReportId, query: Record<string, string>, company = a) {
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; ; page += 1) {
      const res = await list(
        report,
        { ...query, page: String(page), pageSize: "3" },
        company.cookies.admin,
      );
      expect(res.status).toBe(200);
      const body = res.body as Page;
      rows.push(...body.data);
      if (rows.length >= body.meta.total) return { rows, meta: body.meta };
    }
  }

  beforeAll(async () => {
    db = await createMigratedSchema("report_list_api");
    api = buildReportsApp(db);
    a = await seededCompany(db, api, "Reportes A");
    b = await seededCompany(db, api, "Reportes B");
    // La empresa B está en Producción.
    const prisma = db.database.prisma;
    const admin = {
      userId: b.adminId,
      companyId: b.companyId,
      role: "ADMIN" as const,
      requestId: randomUUID(),
    };
    const configuration = createTaxpayerConfiguration({
      uow: createTaxpayerUnitOfWork(prisma),
      configs: createCompanyConfigRepository(prisma),
      authorizer: createAuthorizer({
        memberships: createMembershipReader(prisma),
        securityEvents: { emit: () => undefined },
      }),
    });
    await configuration.updateProfile(admin, {
      ruc: "1790012345001",
      legalName: "Comercial Andina S.A.",
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      accountingRequired: true,
      expectedVersion: null,
    });
    await configuration.changeEnvironment(admin, { environment: "PRODUCTION", expectedVersion: 1 });
  }, 300_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("responde cada reporte con sus filas y su total, sin auditar la consulta", async () => {
    for (const report of REPORT_IDS) {
      const res = await list(report);
      expect([report, res.status]).toEqual([report, 200]);
      const body = res.body as Page;
      expect(body.meta).toMatchObject({ page: 1, pageSize: 25 });
      expect(body.meta.total, report).toBeGreaterThan(0);
      expect(body.data.length, report).toBe(Math.min(body.meta.total, 25));
    }
    expect(await exportEvents(db, a.companyId)).toEqual([]);
  });

  it("pagina con el mismo total y sin repetir ni perder filas", async () => {
    const { rows, meta } = await allRows("issued-documents", {});
    expect(rows.length).toBe(meta.total);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
  });

  it("usa por defecto el ambiente vigente de la empresa y los dos solo si se eligen", async () => {
    const testRows = await allRows("issued-documents", {});
    expect(testRows.meta.environment).toBe("TEST");
    expect(testRows.rows.every((row) => row.environment === "TEST")).toBe(true);
    expect(testRows.rows.map((row) => row.id)).not.toContain(a.ids.productionInvoice);
    const all = await allRows("issued-documents", { environment: "ALL" });
    expect(all.meta.environment).toBe("ALL");
    expect(all.rows.map((row) => row.id)).toContain(a.ids.productionInvoice);
    // La empresa B está en Producción: por defecto solo ve sus comprobantes de Producción.
    const production = await allRows("invoices", {}, b);
    expect(production.meta.environment).toBe("PRODUCTION");
    expect(production.rows.map((row) => row.id)).toEqual([b.ids.productionInvoice]);
    // El inventario y los terceros no tienen ambiente.
    expect(((await list("parties")).body as Page).meta.environment).toBeNull();
  });

  it("aplica los estados por defecto: todos en Documentos emitidos, autorizados en los demás", async () => {
    const issued = await allRows("issued-documents", {});
    expect(new Set(issued.rows.map((row) => row.state))).toEqual(
      new Set(["AUTHORIZED", "NOT_AUTHORIZED", "RECEIVED", "RESERVED", "RETURNED"]),
    );
    const invoices = await allRows("invoices", {});
    expect(invoices.rows.map((row) => row.id)).toEqual([a.ids.hostileInvoice, a.ids.invoice]);
    const withholdings = await allRows("withholdings", {});
    expect(new Set(withholdings.rows.map((row) => row.documentId))).toEqual(
      new Set([a.ids.withholding]),
    );
    const every = await allRows("invoices", { state: "ALL" });
    expect(every.rows.map((row) => row.id)).toContain(a.ids.rejectedInvoice);
  });

  it("aplica los filtros de cada reporte", async () => {
    expect(
      (await allRows("invoices", { customerIdentification: a.ids.customer! })).rows.map(
        (row) => row.id,
      ),
    ).toEqual([a.ids.hostileInvoice]);
    expect(
      (await allRows("issued-documents", { from: "2026-09-20", to: "2026-09-28" })).rows.map(
        (row) => row.id,
      ),
    ).toEqual([a.ids.debitNote, a.ids.rejectedInvoice, a.ids.hostileInvoice]);
    expect(
      (await allRows("withholdings", { fiscalPeriod: "2026-10", state: "ALL" })).rows,
    ).toHaveLength(1);
    const balances = await allRows("inventory-balances", { productId: a.ids.hugeProduct! });
    expect(balances.rows).toEqual([
      {
        productId: a.ids.hugeProduct,
        code: "A-1",
        name: "Arena a granel",
        balance: "999999999999.999999",
      },
    ]);
    const movements = await allRows("inventory-movements", { movementType: "SALIDA_FACTURA" });
    expect(movements.rows).toEqual([
      expect.objectContaining({
        code: "T-1",
        name: "Tornillo",
        quantity: "-5",
        balanceAfter: "15",
      }),
    ]);
    const parties = await allRows("parties", { identification: a.ids.customer!, role: "CUSTOMER" });
    expect(parties.rows.map((row) => row.id)).toEqual([a.ids.party]);
  });

  it("rechaza el companyId, un filtro de otro reporte y un rango invertido", async () => {
    const queries: Record<string, string>[] = [
      { companyId: b.companyId },
      { state: "AUTHORIZED", role: "CUSTOMER" },
      { from: "2026-09-30", to: "2026-09-01" },
    ];
    for (const query of queries) {
      const res = await list("parties", query);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
    const range = await list("issued-documents", { from: "2026-09-30", to: "2026-09-01" });
    expect(range.status).toBe(400);
  });

  it("aísla cada empresa: nada de la otra aparece en ningún reporte", async () => {
    const ownIds = (company: SeededCompany) => new Set(Object.values(company.ids));
    for (const report of REPORT_IDS) {
      const { rows } = await allRows(report, report === "parties" ? { status: "ALL" } : {});
      const seen = JSON.stringify(rows);
      for (const id of ownIds(b)) {
        expect([report, seen.includes(id)]).toEqual([report, false]);
      }
    }
  });

  it("pide sesión y el permiso de lectura", async () => {
    const anonymous = await list("issued-documents", {}, null);
    expect(anonymous.status).toBe(401);
    const denied = buildReportsApp(db, { denyReports: true });
    const res = await request(denied.app)
      .get("/api/v1/reports/issued-documents")
      .set("Cookie", a.cookies.operator);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});

// Planes de consulta de la búsqueda de terceros y productos (add-parties-and-products, design D10,
// tarea 6.1): con datos sembrados y analizados, el prefijo de identificación y de códigos usa su
// índice btree de colación C con una condición de rango, y el orden por nombre usa su índice sin
// ordenar en memoria. No mide tiempos: eso es del benchmark dedicado (design D16).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  "Index Cond"?: string;
  Plans?: PlanNode[];
};

function nodes(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}

describe("planes de la búsqueda", () => {
  let db: MigratedSchema;
  let company: string;

  const explain = async (sql: string) => {
    const rows = await db.database.prisma.$queryRawUnsafe<{ "QUERY PLAN": [{ Plan: PlanNode }] }[]>(
      `EXPLAIN (FORMAT JSON) ${sql}`,
    );
    return nodes(rows[0]!["QUERY PLAN"][0].Plan);
  };

  beforeAll(async () => {
    db = await createMigratedSchema("search_plans");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    company = await insertCompany(db.database.prisma, "Empresa");
    const user = (await insertMember(db.database.prisma, company, { name: "Ana" })).userId;
    const s = db.name;
    // 4000 terceros y 4000 productos de la empresa, con prefijos repartidos.
    await db.database.prisma.$executeRawUnsafe(`
      INSERT INTO "${s}"."party" (id, company_id, identification_type, identification, legal_name,
        search_name, search_identification, created_by, updated_by, updated_at)
      SELECT gen_random_uuid()::text, '${company}', '04', lpad(g::text, 10, '0') || '001',
        'Tercero ' || g, 'tercero ' || g, lpad(g::text, 10, '0') || '001', '${user}', '${user}', now()
      FROM generate_series(1, 4000) g`);
    // Producto e IVA en la misma transacción: el trigger diferido exige el IVA al confirmar.
    await db.database.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
      INSERT INTO "${s}"."product" (id, company_id, kind, main_code, auxiliary_code, name, unit_price,
        search_name, search_main_code, search_auxiliary_code, created_by, updated_by, updated_at)
      SELECT 'p' || g, '${company}', 'GOOD', 'P' || lpad(g::text, 6, '0'), 'A-' || g, 'Producto ' || g,
        1, 'producto ' || g, 'p' || lpad(g::text, 6, '0'), 'a-' || g, '${user}', '${user}', now()
      FROM generate_series(1, 4000) g`);
      await tx.$executeRawUnsafe(`
      INSERT INTO "${s}"."product_tax" (product_id, company_id, catalog_type, entry_key)
      SELECT 'p' || g, '${company}', 'iva-rate', '4' FROM generate_series(1, 4000) g`);
    });
    for (const table of ["party", "product", "product_tax"]) {
      await db.database.prisma.$executeRawUnsafe(`ANALYZE "${s}"."${table}"`);
    }
  });

  afterAll(async () => {
    await db.drop();
  });

  it("el prefijo de identificación usa su índice con una condición de rango", async () => {
    const plan = await explain(
      `SELECT id FROM "${db.name}"."party" WHERE company_id = '${company}' AND search_identification LIKE '000000012%'`,
    );
    const scan = plan.find((n) => n["Index Name"] === "party_company_id_search_identification_idx");
    expect(scan, JSON.stringify(plan)).toBeDefined();
    expect(scan!["Index Cond"]).toContain("search_identification >=");
  });

  it("los prefijos de código principal y auxiliar usan sus índices con una condición de rango", async () => {
    for (const [column, index, prefix] of [
      ["search_main_code", "product_company_id_search_main_code_idx", "p00012"],
      ["search_auxiliary_code", "product_company_id_search_auxiliary_code_idx", "a-12"],
    ] as const) {
      const plan = await explain(
        `SELECT id FROM "${db.name}"."product" WHERE company_id = '${company}' AND ${column} LIKE '${prefix}%'`,
      );
      const scan = plan.find((n) => n["Index Name"] === index);
      expect(scan, JSON.stringify(plan)).toBeDefined();
      expect(scan!["Index Cond"]).toContain(`${column} >=`);
    }
  });

  it("la primera página por nombre usa el índice de orden, sin ordenar en memoria", async () => {
    for (const [table, index] of [
      ["party", "party_company_id_status_search_name_id_idx"],
      ["product", "product_company_id_status_search_name_id_idx"],
    ] as const) {
      const plan = await explain(
        `SELECT id FROM "${db.name}"."${table}" WHERE company_id = '${company}' AND status = 'ACTIVE' ORDER BY search_name, id LIMIT 25`,
      );
      expect(
        plan.some((n) => n["Index Name"] === index),
        JSON.stringify(plan),
      ).toBe(true);
      expect(plan.some((n) => n["Node Type"] === "Sort")).toBe(false);
    }
  });

  it("los recuentos por entrada usan el índice de referencias de la empresa", async () => {
    const plan = await explain(
      `SELECT catalog_type, entry_key, count(*) FROM "${db.name}"."product_tax" WHERE company_id = '${company}' AND catalog_type = 'iva-rate' AND entry_key = '4' GROUP BY 1, 2`,
    );
    expect(
      plan.some((n) => n["Node Type"].includes("Scan")),
      JSON.stringify(plan),
    ).toBe(true);
  });
});

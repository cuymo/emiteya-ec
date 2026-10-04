// Lista, detalle y kárdex del inventario sobre HTTP (add-minimal-inventory, tarea 8.1, design D8 y
// D14): el estado derivado de la marca y del inventario, sin saldo antes de inicializar, el saldo
// negativo indicado, los filtros aislados por empresa y el kárdex por fechas de Ecuador.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { Registry } from "@prometheus-io/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  createStockRepository,
  registerInventoryMetrics,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  createProduct,
  insertReservedDocument,
  readyCompany,
  type ReadyCompany,
} from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Item = {
  productId: string;
  name: string;
  state: string;
  balance: string | null;
  negative: boolean;
};
type ListBody = { data: Item[]; meta: { page: number; pageSize: number; total: number } };
type Movement = {
  type: string;
  delta: string;
  balanceAfter: string;
  origin: string;
  actorName: string | null;
  documentNumber: string | null;
  reason: string | null;
  occurredAt: string;
};

describe("lista, detalle y kárdex del inventario sobre HTTP", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const ids: Record<"marked" | "active" | "negative" | "disabled" | "untracked", string> = {
    marked: "",
    active: "",
    negative: "",
    disabled: "",
    untracked: "",
  };

  const get = (company: ReadyCompany, path: string, who: "admin" | "operator" = "operator") =>
    request(api.app).get(`/api/v1/inventory/items${path}`).set("Cookie", company.cookies[who]);
  const list = async (company: ReadyCompany, query = "") => {
    const res = await get(company, query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as ListBody;
  };
  const namesOf = (body: ListBody) => body.data.map((item) => item.name);

  async function product(company: ReadyCompany, name: string, mainCode: string, tracked: boolean) {
    const id = await createProduct(db, company, { unitPrice: "1", name, mainCode });
    if (tracked) await prisma.product.update({ where: { id }, data: { stockTracked: true } });
    return id;
  }
  /** Inventario sembrado por el repositorio, con momentos fijos. */
  const initialize = (company: ReadyCompany, productId: string, quantity: string, at: Date) =>
    prisma.$transaction((tx) =>
      createStockRepository(tx).initialize({
        companyId: company.companyId,
        productId,
        quantity,
        note: "Conteo de apertura",
        actorUserId: company.adminId,
        at,
      }),
    );
  const append = (
    company: ReadyCompany,
    productId: string,
    movement: { type: "ENTRADA_MANUAL" | "AJUSTE" | "SALIDA_FACTURA"; delta: string; at: Date },
    extra: { documentId?: string; documentNumber?: string; reason?: string } = {},
  ) =>
    prisma.$transaction((tx) =>
      createStockRepository(tx).append({
        companyId: company.companyId,
        productId,
        type: movement.type,
        delta: movement.delta,
        origin: movement.type === "SALIDA_FACTURA" ? "SYSTEM" : "USER",
        actorUserId: movement.type === "SALIDA_FACTURA" ? null : company.adminId,
        occurredAt: movement.at,
        // La base exige la clave en las entradas y los ajustes; su huella aquí es sintética.
        ...(movement.type === "SALIDA_FACTURA"
          ? {}
          : {
              idempotency: {
                operation:
                  movement.type === "AJUSTE"
                    ? ("inventory.adjust" as const)
                    : ("inventory.entry" as const),
                key: randomUUID(),
                requestHash: "0".repeat(64),
              },
            }),
        ...extra,
      }),
    );

  beforeAll(async () => {
    db = await createMigratedSchema("inventory_reads_api");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    api = buildTaxpayerApp(db);
    a = await readyCompany(api, db, { slug: "lista" });
    b = await readyCompany(api, db, { slug: "listb" });
    const now = new Date();
    ids.marked = await product(a, "A1 Marcado sin inicializar", "MAR-1", true);
    ids.active = await product(a, "A2 Activo", "ACT-2", true);
    ids.negative = await product(a, "A3 Negativo", "NEG-3", true);
    ids.disabled = await product(a, "A4 Desactivado", "DES-4", true);
    ids.untracked = await product(a, "A5 Sin control", "SIN-5", false);
    await initialize(a, ids.active, "8", now);
    await initialize(a, ids.negative, "0", now);
    await append(a, ids.negative, { type: "AJUSTE", delta: "-1", at: now }, { reason: "Merma" });
    await initialize(a, ids.disabled, "0", now);
    await prisma.product.update({ where: { id: ids.disabled }, data: { stockTracked: false } });
    // La empresa B con un saldo negativo: nunca aparece en las listas de A.
    const other = await product(b, "B1 Negativo de otra empresa", "NEG-B", true);
    await initialize(b, other, "1", now);
    await append(b, other, { type: "AJUSTE", delta: "-6", at: now }, { reason: "Merma" });
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("muestra los cuatro estados, sin saldo antes de inicializar y con el negativo indicado", async () => {
    const body = await list(a);
    expect(body.meta).toEqual({ page: 1, pageSize: 25, total: 4 });
    expect(
      body.data.map(({ name, state, balance, negative }) => ({ name, state, balance, negative })),
    ).toEqual([
      {
        name: "A1 Marcado sin inicializar",
        state: "TRACKED_NOT_INITIALIZED",
        balance: null,
        negative: false,
      },
      { name: "A2 Activo", state: "TRACKED_INITIALIZED", balance: "8", negative: false },
      { name: "A3 Negativo", state: "TRACKED_INITIALIZED", balance: "-1", negative: true },
      { name: "A4 Desactivado", state: "DISABLED_INITIALIZED", balance: "0", negative: false },
    ]);
    expect(namesOf(body)).not.toContain("A5 Sin control");
  });

  it("filtra por estado y por saldo negativo, sin datos de otra empresa", async () => {
    expect(namesOf(await list(a, "?state=TRACKED_NOT_INITIALIZED"))).toEqual([
      "A1 Marcado sin inicializar",
    ]);
    expect(namesOf(await list(a, "?state=TRACKED_INITIALIZED"))).toEqual([
      "A2 Activo",
      "A3 Negativo",
    ]);
    expect(namesOf(await list(a, "?state=DISABLED_INITIALIZED"))).toEqual(["A4 Desactivado"]);
    expect(namesOf(await list(a, "?state=NEGATIVE"))).toEqual(["A3 Negativo"]);
    expect(namesOf(await list(b, "?state=NEGATIVE"))).toEqual(["B1 Negativo de otra empresa"]);
    for (const query of ["", "?state=NEGATIVE", "?state=TRACKED_INITIALIZED", "?search=neg"]) {
      expect(namesOf(await list(a, query))).not.toContain("B1 Negativo de otra empresa");
    }
    expect((await get(a, "?state=AGOTADO")).status).toBe(400);
  });

  it("busca por código y por nombre, y pagina en un orden estable", async () => {
    expect(namesOf(await list(a, "?search=act-"))).toEqual(["A2 Activo"]);
    expect(namesOf(await list(a, "?search=desactivado"))).toEqual(["A4 Desactivado"]);
    expect(namesOf(await list(a, "?search=sin control"))).toEqual([]);
    const first = await list(a, "?pageSize=3&page=1");
    const second = await list(a, "?pageSize=3&page=2");
    expect(first.meta.total).toBe(4);
    expect([...namesOf(first), ...namesOf(second)]).toEqual(namesOf(await list(a)));
    expect(namesOf(await list(a, "?pageSize=3&page=1"))).toEqual(namesOf(first));
  });

  it("el detalle muestra el estado también sin marca ni inventario, y la inicialización", async () => {
    const untracked = await get(a, `/${ids.untracked}`);
    expect(untracked.status).toBe(200);
    expect((untracked.body as { data: object }).data).toMatchObject({
      state: "NOT_TRACKED",
      balance: null,
      negative: false,
      initializedAt: null,
      initializedByName: null,
      lastMovementAt: null,
    });
    const negative = await get(a, `/${ids.negative}`, "admin");
    expect((negative.body as { data: object }).data).toMatchObject({
      productId: ids.negative,
      mainCode: "NEG-3",
      productStatus: "ACTIVE",
      state: "TRACKED_INITIALIZED",
      balance: "-1",
      negative: true,
      initializedByName: "Admin lista",
    });
  });

  it("muestra el kárdex por fechas de Ecuador, del más reciente al más antiguo, con el saldo de cada movimiento", async () => {
    const id = await product(a, "A6 Con kárdex", "KAR-6", true);
    const document = await insertReservedDocument(db, a);
    // Fronteras del día en Ecuador (UTC-05:00): fuera, dentro, dentro y fuera de octubre.
    await initialize(a, id, "10", new Date("2026-10-01T04:59:00Z"));
    await append(a, id, {
      type: "ENTRADA_MANUAL",
      delta: "5",
      at: new Date("2026-10-01T05:00:00Z"),
    });
    await append(
      a,
      id,
      { type: "SALIDA_FACTURA", delta: "-20", at: new Date("2026-11-01T04:59:59Z") },
      { documentId: document.id, documentNumber: document.documentNumber },
    );
    await append(
      a,
      id,
      { type: "AJUSTE", delta: "2", at: new Date("2026-11-01T05:00:00Z") },
      { reason: "Conteo físico" },
    );
    const res = await get(a, `/${id}/movements?from=2026-10-01&to=2026-10-31`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as { data: Movement[]; meta: { total: number } };
    expect(body.meta.total).toBe(2);
    expect(
      body.data.map(({ type, delta, balanceAfter, origin, actorName, documentNumber }) => ({
        type,
        delta,
        balanceAfter,
        origin,
        actorName,
        documentNumber,
      })),
    ).toEqual([
      {
        type: "SALIDA_FACTURA",
        delta: "-20",
        balanceAfter: "-5",
        origin: "SYSTEM",
        actorName: null,
        documentNumber: document.documentNumber,
      },
      {
        type: "ENTRADA_MANUAL",
        delta: "5",
        balanceAfter: "15",
        origin: "USER",
        actorName: "Admin lista",
        documentNumber: null,
      },
    ]);
    const all = (await get(a, `/${id}/movements`)).body as { data: Movement[] };
    expect(all.data.map((movement) => movement.type)).toEqual([
      "AJUSTE",
      "SALIDA_FACTURA",
      "ENTRADA_MANUAL",
      "INICIAL",
    ]);
    expect(all.data[0]).toMatchObject({ reason: "Conteo físico", balanceAfter: "-3" });
    expect(all.data[3]).toMatchObject({ reason: "Conteo de apertura", balanceAfter: "10" });
    const paged = (await get(a, `/${id}/movements?pageSize=1&page=2`)).body as {
      data: Movement[];
      meta: { total: number };
    };
    expect([paged.data[0]!.type, paged.meta.total]).toEqual(["SALIDA_FACTURA", 4]);
  });

  it("rechaza un rango invertido sin buscar movimientos", async () => {
    const res = await get(a, `/${ids.active}/movements?from=2026-10-31&to=2026-10-01`);
    expect(res.status).toBe(400);
  });

  // El 403 de las consultas lo prueba test/inventory/permissions.test.ts: los dos roles las tienen.
  it("sin sesión 401 y otra empresa 404 en el detalle y el kárdex", async () => {
    expect((await request(api.app).get("/api/v1/inventory/items")).status).toBe(401);
    expect((await get(b, `/${ids.active}`)).status).toBe(404);
    expect((await get(b, `/${ids.active}/movements`)).status).toBe(404);
    expect((await get(a, `/${randomUUID()}`)).status).toBe(404);
  });

  it("la métrica cuenta los productos con saldo negativo, sin identificadores", async () => {
    const registry = new Registry();
    registerInventoryMetrics(registry, { prisma });
    const text = await registry.metrics();
    const negatives = await prisma.stockBalance.count({ where: { balance: { lt: 0 } } });
    expect(negatives).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(new RegExp(`^inventory_negative_balances ${negatives}$`, "m"));
    expect(text).not.toMatch(new RegExp(a.companyId));
  });
});

// Entradas manuales y ajustes sobre HTTP (add-minimal-inventory, tarea 7.1, design D7, D11, D12 y
// D14): el saldo cambia solo con movimientos, cada uno con su clave de idempotencia por empresa,
// operación y clave y la huella de su solicitud; sin auditoría duplicada y sin rutas para editar o
// borrar movimientos.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { Registry } from "@prometheus-io/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import {
  inventoryModule,
  registerInventoryMetrics,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { createProduct, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { balanceOf, expectReconciled } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = { data: Record<string, unknown>; error: { code: string; message: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("entradas y ajustes del inventario sobre HTTP", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;

  const post = (
    company: ReadyCompany,
    who: "admin" | "operator",
    path: string,
    body: object,
    key: string | null = randomUUID(),
  ) => {
    const req = request(api.app)
      .post(`/api/v1/inventory/items/${path}`)
      .set("Cookie", company.cookies[who]);
    return (key === null ? req : req.set("Idempotency-Key", key)).send(body);
  };
  const entry = (
    company: ReadyCompany,
    productId: string,
    quantity: string,
    key?: string | null,
    who: "admin" | "operator" = "operator",
    note?: string,
  ) =>
    post(
      company,
      who,
      `${productId}/entries`,
      note === undefined ? { quantity } : { quantity, note },
      key,
    );
  const adjust = (
    company: ReadyCompany,
    productId: string,
    delta: string,
    reason: string | undefined,
    key?: string | null,
    who: "admin" | "operator" = "admin",
  ) =>
    post(
      company,
      who,
      `${productId}/adjustments`,
      reason === undefined ? { delta } : { delta, reason },
      key,
    );

  /** Bien marcado e inicializado con `quantity`. */
  async function stocked(company: ReadyCompany, quantity: string) {
    const product = await createProduct(db, company, {
      unitPrice: "1",
      name: `Bien ${randomUUID().slice(0, 6)}`,
    });
    await prisma.product.update({ where: { id: product }, data: { stockTracked: true } });
    const res = await request(api.app)
      .post(`/api/v1/inventory/items/${product}/initialization`)
      .set("Cookie", company.cookies.admin)
      .send({ quantity });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return product;
  }
  const movementsOf = (productId: string) =>
    prisma.stockMovement.findMany({ where: { productId }, orderBy: { position: "asc" } });

  beforeAll(async () => {
    db = await createMigratedSchema("inventory_movements_api");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    api = buildTaxpayerApp(db);
    a = await readyCompany(api, db, { slug: "mova" });
    b = await readyCompany(api, db, { slug: "movb" });
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("una entrada suma al saldo con su actor y su nota, y un ajuste puede dejarlo negativo con su motivo", async () => {
    const product = await stocked(a, "4");
    const res = await entry(a, product, "10", undefined, "operator", "Compra a proveedor");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(bodyOf(res).data).toMatchObject({
      type: "ENTRADA_MANUAL",
      delta: "10",
      balanceAfter: "14",
      origin: "USER",
      actorName: "Operador mova",
      reason: "Compra a proveedor",
      documentNumber: null,
      position: 2,
    });
    const adjusted = await adjust(a, product, "-18", "Merma por rotura");
    expect(adjusted.status, JSON.stringify(adjusted.body)).toBe(201);
    expect(bodyOf(adjusted).data).toMatchObject({
      type: "AJUSTE",
      delta: "-18",
      balanceAfter: "-4",
      actorName: "Admin mova",
      reason: "Merma por rotura",
    });
    expect(await balanceOf(prisma, a.companyId, product)).toBe("-4");
    await expectReconciled(prisma, a.companyId);
  });

  it("rechaza una entrada de cero o negativa y un ajuste sin motivo o de cero", async () => {
    const product = await stocked(a, "1");
    for (const res of [
      await entry(a, product, "0"),
      await entry(a, product, "-2"),
      await adjust(a, product, "-1", undefined),
      await adjust(a, product, "0", "Merma"),
    ]) {
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
    expect(await movementsOf(product)).toHaveLength(1);
  });

  it("el doble envío, secuencial o simultáneo, registra un solo movimiento y la repetición lo devuelve", async () => {
    const product = await stocked(a, "0");
    const key = randomUUID();
    const first = await entry(a, product, "10", key);
    const second = await entry(a, product, "10.00", key);
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(bodyOf(second).data.id).toBe(bodyOf(first).data.id);
    const concurrentKey = randomUUID();
    const results = await Promise.all([
      entry(a, product, "2", concurrentKey),
      entry(a, product, "2", concurrentKey),
      entry(a, product, "2", concurrentKey),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(results.map((res) => bodyOf(res).data.id)).size).toBe(1);
    expect(await balanceOf(prisma, a.companyId, product)).toBe("12");
    const adjustKey = randomUUID();
    const adjusted = await Promise.all([
      adjust(a, product, "-1", "Conteo", adjustKey),
      adjust(a, product, "-1", "Conteo", adjustKey),
    ]);
    expect(adjusted.map((res) => res.status).sort()).toEqual([200, 201]);
    expect(await balanceOf(prisma, a.companyId, product)).toBe("11");
  });

  it("la misma clave con otra solicitud se rechaza, y sin clave no se registra nada", async () => {
    const product = await stocked(a, "0");
    const key = randomUUID();
    expect((await entry(a, product, "5", key, "operator", "Nota")).status).toBe(201);
    for (const res of [
      await entry(a, product, "6", key, "operator", "Nota"),
      await entry(a, product, "5", key, "operator", "Otra nota"),
    ]) {
      expect([res.status, bodyOf(res).error.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    }
    const adjustKey = randomUUID();
    expect((await adjust(a, product, "-1", "Merma", adjustKey)).status).toBe(201);
    expect(bodyOf(await adjust(a, product, "-1", "Robo", adjustKey)).error.code).toBe(
      "IDEMPOTENCY_KEY_REUSED",
    );
    const missing = await entry(a, product, "1", null);
    expect([missing.status, bodyOf(missing).error.code]).toEqual([400, "IDEMPOTENCY_KEY_REQUIRED"]);
    expect(await balanceOf(prisma, a.companyId, product)).toBe("4");
  });

  it("la misma clave sirve en una entrada y en un ajuste, y en otra empresa", async () => {
    const productA = await stocked(a, "0");
    const productB = await stocked(b, "0");
    const key = randomUUID();
    expect((await entry(a, productA, "3", key)).status).toBe(201);
    expect((await adjust(a, productA, "-1", "Conteo", key)).status).toBe(201);
    expect((await entry(b, productB, "3", key)).status).toBe(201);
    expect(await balanceOf(prisma, a.companyId, productA)).toBe("2");
    expect(await balanceOf(prisma, b.companyId, productB)).toBe("3");
  });

  it("sin inventario inicializado o con el control desactivado, rechaza indicando el estado", async () => {
    const untracked = await createProduct(db, a, { unitPrice: "1", name: "Sin inventario" });
    await prisma.product.update({ where: { id: untracked }, data: { stockTracked: true } });
    expect(bodyOf(await entry(a, untracked, "1")).error.code).toBe("INVENTORY_NOT_INITIALIZED");
    const disabled = await stocked(a, "0");
    const off = await request(api.app)
      .put(`/api/v1/inventory/items/${disabled}/tracking`)
      .set("Cookie", a.cookies.admin)
      .send({ tracked: false });
    expect(off.status).toBe(200);
    expect(bodyOf(await entry(a, disabled, "1")).error.code).toBe("STOCK_TRACKING_DISABLED");
    expect(bodyOf(await adjust(a, disabled, "1", "Conteo")).error.code).toBe(
      "STOCK_TRACKING_DISABLED",
    );
  });

  it("permisos, empresa y sesión, sin eventos de auditoría por los movimientos", async () => {
    const product = await stocked(a, "2");
    expect((await adjust(a, product, "-1", "Merma", undefined, "operator")).status).toBe(403);
    expect((await entry(b, product, "1")).status).toBe(404);
    expect((await adjust(b, product, "-1", "Merma")).status).toBe(404);
    expect(
      (
        await request(api.app)
          .post(`/api/v1/inventory/items/${product}/entries`)
          .set("Idempotency-Key", randomUUID())
          .send({ quantity: "1" })
      ).status,
    ).toBe(401);
    const audits = () => prisma.auditEvent.count({ where: { companyId: a.companyId } });
    const before = await audits();
    expect((await entry(a, product, "1")).status).toBe(201);
    expect((await adjust(a, product, "-1", "Merma")).status).toBe(201);
    expect(await audits()).toBe(before);
    expect(await balanceOf(prisma, a.companyId, product)).toBe("2");
  });

  it("una empresa indicada en el cuerpo se rechaza sin registrar nada", async () => {
    const otherCompanyMovements = () =>
      prisma.stockMovement.count({ where: { companyId: b.companyId } });
    const before = await otherCompanyMovements();
    const marked = await createProduct(db, a, { unitPrice: "1", name: "Marcado con empresa" });
    await prisma.product.update({ where: { id: marked }, data: { stockTracked: true } });
    const initialization = await request(api.app)
      .post(`/api/v1/inventory/items/${marked}/initialization`)
      .set("Cookie", a.cookies.admin)
      .send({ quantity: "1", companyId: b.companyId });
    const product = await stocked(a, "1");
    for (const res of [
      initialization,
      await post(a, "operator", `${product}/entries`, { quantity: "1", companyId: b.companyId }),
      await post(a, "admin", `${product}/adjustments`, {
        delta: "-1",
        reason: "Merma",
        companyId: b.companyId,
      }),
    ]) {
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
    expect(await balanceOf(prisma, a.companyId, marked)).toBeNull();
    expect(await movementsOf(product)).toHaveLength(1);
    expect(await otherCompanyMovements()).toBe(before);
  });

  it("una entrada equivocada se corrige con un ajuste y sigue en el kárdex", async () => {
    const product = await stocked(a, "0");
    expect((await entry(a, product, "10")).status).toBe(201);
    expect((await adjust(a, product, "-9", "La entrada era de 1 unidad")).status).toBe(201);
    expect(
      (await movementsOf(product)).map((movement) => [
        movement.movementType,
        movement.delta.toFixed(),
      ]),
    ).toEqual([
      ["INICIAL", "0"],
      ["ENTRADA_MANUAL", "10"],
      ["AJUSTE", "-9"],
    ]);
    expect(await balanceOf(prisma, a.companyId, product)).toBe("1");
  });

  it("no hay rutas para editar ni borrar movimientos ni para fijar el saldo", async () => {
    const product = await stocked(a, "1");
    const [initial] = await movementsOf(product);
    for (const [method, path] of [
      ["put", `/api/v1/inventory/items/${product}/movements/${initial!.id}`],
      ["delete", `/api/v1/inventory/items/${product}/movements/${initial!.id}`],
      ["put", `/api/v1/inventory/items/${product}/balance`],
      ["post", `/api/v1/inventory/items/${product}/recalculate`],
    ] as const) {
      const res = await request(api.app)[method](path).set("Cookie", a.cookies.admin).send({});
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(await movementsOf(product)).toHaveLength(1);
  });

  it("la métrica cuenta los movimientos registrados por tipo, no las repeticiones", async () => {
    const registry = new Registry();
    const service = inventoryModule({
      prisma,
      authorizer: createAuthorizer({
        memberships: createMembershipReader(prisma),
        securityEvents: { emit: () => undefined },
      }),
      observer: registerInventoryMetrics(registry, { prisma }),
    }).service;
    const product = await stocked(a, "0");
    const ctx = {
      userId: a.adminId,
      companyId: a.companyId,
      role: "ADMIN" as const,
      requestId: "req-metrica-01",
    };
    const key = randomUUID();
    await service.entry(ctx, product, key, { quantity: "2" });
    await service.entry(ctx, product, key, { quantity: "2" });
    await service.adjust(ctx, product, randomUUID(), { delta: "-1", reason: "Conteo" });
    const text = await registry.metrics();
    expect(text).toMatch(/^inventory_movements_total\{type="ENTRADA_MANUAL"\} 1$/m);
    expect(text).toMatch(/^inventory_movements_total\{type="AJUSTE"\} 1$/m);
    expect(text).not.toMatch(new RegExp(a.companyId));
  });
});

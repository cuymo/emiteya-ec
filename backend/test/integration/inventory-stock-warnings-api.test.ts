// Aviso de existencias en la vista previa del borrador (add-minimal-inventory, tarea 9.1, design D9):
// orientativo, aparte de los `issues` y sin bloquear la emisión. Un producto marcado sin inventario
// avisa sin tratarse como saldo cero.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, createProduct, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { balanceOf } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Preview = {
  issues: { code: string }[];
  stockWarnings: { code: string; productId: string; requested: string; balance: string | null }[];
};
type DraftBody = { data: { id: string; version: number; preview: Preview } };

describe("aviso de existencias en el borrador", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  const p12Dir = inject("p12FixturesDir");

  const call = (method: "get" | "post", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", a.cookies.operator);

  async function product(tracked: boolean, initial?: string) {
    const id = await createProduct(db, a, {
      unitPrice: "2",
      name: `Bien ${randomUUID().slice(0, 6)}`,
    });
    if (tracked) await prisma.product.update({ where: { id }, data: { stockTracked: true } });
    if (initial !== undefined) {
      const res = await request(api.app)
        .post(`/api/v1/inventory/items/${id}/initialization`)
        .set("Cookie", a.cookies.admin)
        .send({ quantity: initial });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }
    return id;
  }
  async function draftWith(lines: { productId: string; quantity: string }[]) {
    const res = await call("post", "/invoices/drafts").send({
      emissionPointId: a.emissionPointId,
      buyerPartyId: a.customerId,
      lines: lines.map((line) => ({ ...line, discount: "0" })),
      payments: [{ paymentMethod: "01" }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return (res.body as DraftBody).data;
  }
  const previewOf = async (draftId: string) =>
    ((await call("get", `/invoices/drafts/${draftId}`)).body as DraftBody).data.preview;

  beforeAll(async () => {
    db = await createMigratedSchema("inventory_stock_warnings_api");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      invoices: { jobs: createPrismaJobStore(prisma, db.name) },
    });
    a = await readyCompany(api, db, { slug: "aviso", pool, p12Dir });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("3 + 4 del mismo producto sobre un saldo de 5 avisa 7 frente a 5, sin bloquear", async () => {
    const id = await product(true, "5");
    const draft = await draftWith([
      { productId: id, quantity: "3" },
      { productId: id, quantity: "4" },
    ]);
    expect(draft.preview.stockWarnings).toEqual([
      { code: "STOCK_BELOW_REQUESTED", productId: id, requested: "7", balance: "5" },
    ]);
    expect(draft.preview.issues).toEqual([]);
    expect((await previewOf(draft.id)).stockWarnings).toEqual(draft.preview.stockWarnings);
  });

  it("un producto marcado sin inventario avisa sin saldo, nunca como cero", async () => {
    const id = await product(true);
    const draft = await draftWith([{ productId: id, quantity: "1" }]);
    expect(draft.preview.stockWarnings).toEqual([
      { code: "STOCK_NOT_INITIALIZED", productId: id, requested: "1", balance: null },
    ]);
  });

  it("sin aviso con saldo suficiente, sin marca o con el control desactivado", async () => {
    const enough = await product(true, "5");
    const untracked = await product(false);
    const disabled = await product(true, "0");
    await prisma.product.update({ where: { id: disabled }, data: { stockTracked: false } });
    const draft = await draftWith([
      { productId: enough, quantity: "2" },
      { productId: enough, quantity: "3" },
      { productId: untracked, quantity: "9" },
      { productId: disabled, quantity: "9" },
    ]);
    expect(draft.preview.stockWarnings).toEqual([]);
  });

  it("la emisión de un borrador con avisos se completa, y la salida llega solo al autorizar", async () => {
    const id = await product(true, "1");
    const draft = await draftWith([{ productId: id, quantity: "4" }]);
    expect(draft.preview.stockWarnings.map((warning) => warning.code)).toEqual([
      "STOCK_BELOW_REQUESTED",
    ]);
    const res = await call("post", "/invoices")
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: draft.id, expectedVersion: draft.version });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await balanceOf(prisma, a.companyId, id)).toBe("1");
  });
});

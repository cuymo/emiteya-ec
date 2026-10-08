// Concurrencia de la reserva de una liquidación de compra con PostgreSQL real (add-purchase-settlements,
// tarea 7.3, design D13 y D14): dos emisiones simultáneas del mismo borrador con claves distintas dejan
// una sola liquidación y la otra responde 409; emisiones simultáneas de borradores distintos reciben
// secuenciales sin huecos ni repetidos. Se repite varias rondas para descartar fallos intermitentes.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PURCHASE_SETTLEMENT_STATEMENTS, type PurchaseSettlementView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: PurchaseSettlementView & { id: string; version: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const ROUNDS = 4;
const DECLARATIONS = { policyVersion: 1, statements: [...PURCHASE_SETTLEMENT_STATEMENTS] };

describe("concurrencia de la reserva de una liquidación de compra", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let supplierId: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const draft = async (quantity = "10") => {
    const res = await request(api.app)
      .post("/api/v1/purchase-settlements/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        emissionPointId: a.emissionPointId,
        supplierPartyId: supplierId,
        lines: [
          {
            description: "Cacao en grano",
            quantity,
            unitPrice: "1.00",
            discount: "0",
            ivaRate: "0",
          },
        ],
        payments: [{ paymentMethod: "01", total: `${quantity}.00`, term: "0", timeUnit: "días" }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (created: { id: string; version: number }, key = randomUUID()) =>
    request(api.app)
      .post("/api/v1/purchase-settlements")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", key)
      .send({ draftId: created.id, expectedVersion: created.version, declarations: DECLARATIONS });

  beforeAll(async () => {
    db = await createMigratedSchema("purchase_settlement_concurrency");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-07T15:00:00Z"),
    });
    a = await readyCompany(api, db, {
      slug: "concurrencia-liquidacion",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    supplierId = await insertPurchaseSupplier(db.database.prisma, a);
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("dos emisiones simultáneas del mismo borrador con claves distintas dejan una sola liquidación", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const created = await draft();
      const before = await db.database.prisma.electronicDocument.count({
        where: { documentType: "03" },
      });
      const results = await Promise.all([emit(created), emit(created)]);
      const statuses = results.map((res) => res.status).sort();
      expect(statuses, JSON.stringify(results.map((res) => res.body as unknown))).toEqual([
        201, 409,
      ]);
      const conflict = results.find((res) => res.status === 409)!;
      expect(bodyOf(conflict).error.code).toBe("PURCHASE_SETTLEMENT_DRAFT_ALREADY_EMITTED");
      expect(
        await db.database.prisma.electronicDocument.count({ where: { documentType: "03" } }),
      ).toBe(before + 1);
    }
  });

  it("emisiones simultáneas de borradores distintos reciben secuenciales sin huecos ni repetidos", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const drafts = await Promise.all([draft("1"), draft("2"), draft("3")]);
      const results = await Promise.all(drafts.map((created) => emit(created)));
      expect(results.map((res) => res.status)).toEqual([201, 201, 201]);
      expect(new Set(results.map((res) => bodyOf(res).data.documentNumber)).size).toBe(3);
    }
    const numbers = (
      await db.database.prisma.electronicDocument.findMany({
        where: { companyId: a.companyId, documentType: "03" },
        select: { sequential: true },
      })
    )
      .map((document) => document.sequential)
      .sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => index + 1));
    expect(
      await db.database.prisma.purchaseSettlement.count({ where: { companyId: a.companyId } }),
    ).toBe(numbers.length);
    expect(await db.database.prisma.purchaseSettlementDeclaration.count()).toBe(numbers.length * 4);
  });
});

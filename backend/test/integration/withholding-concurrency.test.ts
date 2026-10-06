// Concurrencia de la reserva de un comprobante de retención con PostgreSQL real
// (add-withholding-receipts, tarea 7.3, design D15): dos retenciones simultáneas al mismo proveedor
// son válidas y reciben secuenciales distintos, porque los documentos sustento son externos y no hay
// recursos compartidos que bloquear; dos emisiones simultáneas del mismo borrador con claves
// distintas dejan una sola retención y la otra responde 409. Se repite varias rondas para descartar
// fallos intermitentes.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { WithholdingReceiptView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: WithholdingReceiptView & { id: string; version: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const ROUNDS = 4;

describe("concurrencia de la reserva de un comprobante de retención", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const draft = async (base = "100.00") => {
    const res = await request(api.app)
      .post("/api/v1/withholding-receipts/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        partyId: a.supplierId,
        relatedParty: "NO",
        emissionPointId: a.emissionPointId,
        supports: [
          {
            documentType: "01",
            supportCode: "01",
            number: "001001000000123",
            issueDate: "2026-10-01",
            totalWithoutTaxes: base,
            importTotal: base,
            taxes: [{ tax: "2", rateEntryKey: "0", base, amount: "0.00" }],
            payments: [{ paymentMethod: "20", total: base }],
            withholdings: [{ tax: "1", entryKey: "312", base }],
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (created: { id: string; version: number }, key = randomUUID()) =>
    request(api.app)
      .post("/api/v1/withholding-receipts")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", key)
      .send({ draftId: created.id, expectedVersion: created.version });

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_concurrency");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-06T15:00:00Z"),
    });
    a = await readyCompany(api, db, {
      slug: "concurrencia-ret",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("dos retenciones simultáneas al mismo proveedor son válidas y tienen secuenciales distintos", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const [first, second] = await Promise.all([draft(), draft("50.00")]);
      const [one, two] = await Promise.all([emit(first), emit(second)]);
      expect([one.status, two.status], JSON.stringify([one.body, two.body])).toEqual([201, 201]);
      expect(bodyOf(one).data.documentNumber).not.toBe(bodyOf(two).data.documentNumber);
      expect([bodyOf(one).data.subject.partyId, bodyOf(two).data.subject.partyId]).toEqual([
        a.supplierId,
        a.supplierId,
      ]);
    }
    // Los secuenciales de las retenciones no tienen huecos ni repetidos.
    const numbers = (
      await db.database.prisma.electronicDocument.findMany({
        where: { companyId: a.companyId, documentType: "07" },
        select: { sequential: true },
      })
    )
      .map((document) => document.sequential)
      .sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => index + 1));
    expect(
      await db.database.prisma.withholdingReceipt.count({ where: { companyId: a.companyId } }),
    ).toBe(numbers.length);
  });

  it("dos emisiones simultáneas del mismo borrador con claves distintas dejan una sola retención", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const created = await draft();
      const before = await db.database.prisma.electronicDocument.count({
        where: { documentType: "07" },
      });
      const results = await Promise.all([emit(created), emit(created)]);
      const statuses = results.map((res) => res.status).sort();
      expect(statuses, JSON.stringify(results.map((res) => res.body as unknown))).toEqual([
        201, 409,
      ]);
      const conflict = results.find((res) => res.status === 409)!;
      expect(bodyOf(conflict).error.code).toBe("WITHHOLDING_DRAFT_ALREADY_EMITTED");
      expect(
        await db.database.prisma.electronicDocument.count({ where: { documentType: "07" } }),
      ).toBe(before + 1);
    }
  });
});

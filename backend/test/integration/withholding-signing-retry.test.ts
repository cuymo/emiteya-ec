// Reintento de la firma de un comprobante de retención (add-withholding-receipts, tarea 7.4, design
// D2, D22 y D23): una retención que quedó reservada por un servicio ocupado se firma con su mismo
// número, su misma clave y su mismo snapshot, con `withholding_receipt.signing_retried`. Una
// retención firmada se devuelve sin efecto ni auditoría; la de otra empresa o un comprobante de otro
// tipo responden `404`; sin sesión, `401`.
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
import { insertDocument } from "./transmission-harness.ts";

type Body = {
  data: WithholdingReceiptView & { id: string; version: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
type App = ReturnType<typeof buildTaxpayerApp>;
const NOW = () => new Date("2026-10-06T15:00:00Z");

describe("reintento de la firma de un comprobante de retención", () => {
  let db: MigratedSchema;
  let api: App;
  let busy: App;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  /** Retención emitida con `app`: con el firmador ocupado queda reservada. */
  const emitted = async (app: App) => {
    const draft = await request(api.app)
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
            totalWithoutTaxes: "100.00",
            importTotal: "115.00",
            taxes: [{ tax: "2", rateEntryKey: "4", base: "100.00", amount: "15.00" }],
            payments: [{ paymentMethod: "20", total: "115.00" }],
            withholdings: [{ tax: "1", entryKey: "312", base: "100.00" }],
          },
        ],
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const res = await request(app.app)
      .post("/api/v1/withholding-receipts")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: bodyOf(draft).data.id, expectedVersion: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const retry = (app: App, id: string, cookie = a.cookies.operator) =>
    request(app.app)
      .post(`/api/v1/withholding-receipts/${id}/signing-attempts`)
      .set("Cookie", cookie);
  const retried = (id: string) =>
    db.database.prisma.auditEvent.count({
      where: {
        action: "withholding_receipt.signing_retried",
        changes: { path: ["withholdingReceiptId"], equals: id },
      },
    });

  beforeAll(async () => {
    db = await createMigratedSchema("withholding_signing_retry");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY }, now: NOW });
    busy = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: NOW,
      withholdingReceipts: {
        signer: {
          signDocument: () =>
            Promise.reject(Object.assign(new Error("ocupado"), { code: "CRYPTO_BUSY" })),
        },
      },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "reintento-ret-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "reintento-ret-b", pool, p12Dir });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("firma la retención reservada con su mismo número, su misma clave y su mismo snapshot", async () => {
    const receipt = await emitted(busy);
    expect(receipt.state).toBe("RESERVED");
    expect(receipt.diagnostic).toMatchObject({
      code: "CRYPTO_BUSY",
      class: "RETRYABLE_OPERATIONAL",
    });
    const snapshot = (
      await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id: receipt.id } })
    ).snapshot;

    const res = await retry(api, receipt.id);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({
      id: receipt.id,
      state: "SIGNED",
      documentNumber: receipt.documentNumber,
      accessKey: receipt.accessKey,
      diagnostic: null,
    });
    const document = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    expect(document.snapshot).toEqual(snapshot);
    expect(await retried(receipt.id)).toBe(1);
    const event = await db.database.prisma.auditEvent.findFirstOrThrow({
      where: { action: "withholding_receipt.signing_retried" },
    });
    expect(event).toMatchObject({
      actorUserId: a.operatorId,
      changes: {
        withholdingReceiptId: receipt.id,
        documentNumber: receipt.documentNumber,
        result: "SIGNED",
      },
    });
  });

  it("un reintento sin éxito deja el diagnóstico y lo audita; una retención firmada se devuelve sin efecto", async () => {
    const receipt = await emitted(busy);
    const failed = await retry(busy, receipt.id);
    expect([
      failed.status,
      bodyOf(failed).data.state,
      bodyOf(failed).data.diagnostic?.code,
    ]).toEqual([200, "RESERVED", "CRYPTO_BUSY"]);
    expect(await retried(receipt.id)).toBe(1);
    await retry(api, receipt.id);
    const unchanged = await retry(api, receipt.id);
    expect([unchanged.status, bodyOf(unchanged).data.state]).toEqual([200, "SIGNED"]);
    expect(await retried(receipt.id)).toBe(2);
  });

  it("una retención de otra empresa o un comprobante de otro tipo responden 404; sin sesión, 401", async () => {
    const receipt = await emitted(api);
    const foreign = await retry(api, receipt.id, b.cookies.admin);
    expect([foreign.status, bodyOf(foreign).error.code]).toEqual([
      404,
      "WITHHOLDING_RECEIPT_NOT_FOUND",
    ]);
    const invoice = await insertDocument(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        points: [
          { establishmentId: a.establishmentId, emissionPointId: a.emissionPointId, code: "001" },
        ],
      },
      "RESERVED",
    );
    const notAWithholding = await retry(api, invoice.id);
    expect([notAWithholding.status, bodyOf(notAWithholding).error.code]).toEqual([
      404,
      "WITHHOLDING_RECEIPT_NOT_FOUND",
    ]);
    expect(
      (await request(api.app).post(`/api/v1/withholding-receipts/${receipt.id}/signing-attempts`))
        .status,
    ).toBe(401);
  });
});

// Idempotencia de la emisión (ERS AC-05; add-invoice-emission, tarea 8.4, design D8) contra
// PostgreSQL: repeticiones, misma clave con otra solicitud, solicitudes simultáneas, falta de clave,
// otra clave sobre un borrador emitido y la misma clave en otra empresa. Ninguna repetición reserva
// otro número.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { InvoiceView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: InvoiceView & { id: string; version: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("idempotencia de la emisión (ERS AC-05)", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  async function draftFor(company: ReadyCompany) {
    const res = await request(api.app)
      .post("/api/v1/invoices/drafts")
      .set("Cookie", company.cookies.admin)
      .send({
        emissionPointId: company.emissionPointId,
        buyerPartyId: company.customerId,
        lines: [{ productId: company.productId, quantity: "3", discount: "1.25" }],
        payments: [{ paymentMethod: "01" }],
      });
    expect(res.status).toBe(201);
    return bodyOf(res).data;
  }
  const emit = (company: ReadyCompany, draft: { id: string; version: number }, key?: string) => {
    const req = request(api.app).post("/api/v1/invoices").set("Cookie", company.cookies.admin);
    return (key === undefined ? req : req.set("Idempotency-Key", key)).send({
      draftId: draft.id,
      expectedVersion: draft.version,
    });
  };
  const counts = async (company: ReadyCompany) => ({
    reservations: await db.database.prisma.fiscalSequenceReservation.count({
      where: { companyId: company.companyId },
    }),
    documents: await db.database.prisma.electronicDocument.count({
      where: { companyId: company.companyId },
    }),
    audits: await db.database.prisma.auditEvent.count({
      where: { companyId: company.companyId, action: { startsWith: "invoice." } },
    }),
  });
  const draftStatus = async (draftId: string) =>
    (await db.database.prisma.invoiceDraft.findUniqueOrThrow({ where: { id: draftId } })).status;

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_idempotency");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "b", pool, p12Dir });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("la misma clave con la misma solicitud devuelve el mismo comprobante sin reservar otro número", async () => {
    const key = randomUUID();
    const draft = await draftFor(a);
    const first = await emit(a, draft, key);
    expect(first.status).toBe(201);
    const before = await counts(a);
    const again = await emit(a, draft, key);
    expect(again.status).toBe(200);
    expect(bodyOf(again).data).toMatchObject({
      id: bodyOf(first).data.id,
      documentNumber: bodyOf(first).data.documentNumber,
      accessKey: bodyOf(first).data.accessKey,
    });
    expect(await counts(a)).toEqual(before);
  });

  it("repite un comprobante ya firmado con la misma clave sin reservar otro número", async () => {
    const key = randomUUID();
    const draft = await draftFor(a);
    const invoice = bodyOf(await emit(a, draft, key)).data;
    const prisma = db.database.prisma;
    // Firmado por fuera para esta prueba: el artefacto y SIGNED en una transacción, como D9.
    if (invoice.state === "RESERVED") {
      await prisma.$transaction(async (tx) => {
        const content = Buffer.from("<factura/>");
        await tx.documentArtifact.create({
          data: {
            companyId: a.companyId,
            documentId: invoice.id,
            kind: "SIGNED_XML",
            mediaType: "application/xml",
            content,
            sizeBytes: content.length,
            sha256: "0".repeat(64),
            metadata: {},
          },
        });
        await tx.electronicDocument.update({
          where: { id: invoice.id },
          data: { state: "SIGNED", signedAt: new Date() },
        });
      });
    }
    const before = await counts(a);
    const again = await emit(a, draft, key);
    expect(again.status).toBe(200);
    expect(bodyOf(again).data).toMatchObject({ id: invoice.id, state: "SIGNED" });
    expect(await counts(a)).toEqual(before);
  });

  it("la misma clave con otro borrador es 409 IDEMPOTENCY_KEY_REUSED y el otro sigue sin emitir", async () => {
    const key = randomUUID();
    expect((await emit(a, await draftFor(a), key)).status).toBe(201);
    const other = await draftFor(a);
    const before = await counts(a);
    const res = await emit(a, other, key);
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await draftStatus(other.id)).toBe("DRAFT");
    expect(await counts(a)).toEqual(before);
  });

  it("dos solicitudes simultáneas con la misma clave crean un solo comprobante con un solo número", async () => {
    const key = randomUUID();
    const draft = await draftFor(a);
    const before = await counts(a);
    const responses = await Promise.all([emit(a, draft, key), emit(a, draft, key)]);
    expect(responses.map((res) => res.status).sort()).toEqual([200, 201]);
    const ids = new Set(responses.map((res) => bodyOf(res).data.id));
    expect(ids.size).toBe(1);
    const after = await counts(a);
    // Una reserva y una firma auditadas, una sola vez.
    expect(after).toEqual({
      reservations: before.reservations + 1,
      documents: before.documents + 1,
      audits: before.audits + 2,
    });
  });

  it("la misma clave a la vez sobre dos borradores: uno se emite y el otro es 409 sin consumir número", async () => {
    const key = randomUUID();
    const [first, second] = [await draftFor(a), await draftFor(a)];
    const before = await counts(a);
    const responses = await Promise.all([emit(a, first, key), emit(a, second, key)]);
    expect(responses.map((res) => res.status).sort()).toEqual([201, 409]);
    const loser = responses.find((res) => res.status === 409)!;
    expect(bodyOf(loser).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await counts(a)).toEqual({
      reservations: before.reservations + 1,
      documents: before.documents + 1,
      audits: before.audits + 2,
    });
    // El número del perdedor nunca se confirmó: lo recibe la siguiente emisión.
    const winner = bodyOf(responses.find((res) => res.status === 201)!).data;
    const next = bodyOf(await emit(a, await draftFor(a), randomUUID())).data;
    expect(Number(next.documentNumber.slice(-9))).toBe(Number(winner.documentNumber.slice(-9)) + 1);
  });

  it("sin Idempotency-Key se rechaza y no se ejecuta la emisión", async () => {
    const draft = await draftFor(a);
    const before = await counts(a);
    const res = await emit(a, draft);
    expect(res.status).toBe(400);
    expect(bodyOf(res).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(await draftStatus(draft.id)).toBe("DRAFT");
    expect(await counts(a)).toEqual(before);
  });

  it("otra clave sobre un borrador ya emitido es 409 con el id de la factura", async () => {
    const draft = await draftFor(a);
    const invoice = bodyOf(await emit(a, draft, randomUUID())).data;
    const before = await counts(a);
    const res = await emit(a, draft, randomUUID());
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("INVOICE_DRAFT_ALREADY_EMITTED");
    expect(bodyOf(res).error.message).toContain(invoice.id);
    expect(await counts(a)).toEqual(before);
  });

  it("la misma clave en otra empresa da a cada una su propio comprobante", async () => {
    const key = randomUUID();
    const fromA = bodyOf(await emit(a, await draftFor(a), key)).data;
    const fromB = await emit(b, await draftFor(b), key);
    expect(fromB.status).toBe(201);
    expect(bodyOf(fromB).data.id).not.toBe(fromA.id);
    // Ninguna ve la factura de la otra.
    for (const [viewer, invoiceId] of [
      [b, fromA.id],
      [a, bodyOf(fromB).data.id],
    ] as const) {
      const res = await request(api.app)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set("Cookie", viewer.cookies.admin);
      expect(res.status).toBe(404);
      expect(bodyOf(res).error.code).toBe("INVOICE_NOT_FOUND");
    }
  });

  it("una empresa no emite el borrador de otra", async () => {
    const draftOfB = await draftFor(b);
    const before = { a: await counts(a), b: await counts(b) };
    const res = await emit(a, draftOfB, randomUUID());
    expect(res.status).toBe(404);
    expect(bodyOf(res).error.code).toBe("INVOICE_DRAFT_NOT_FOUND");
    expect(await draftStatus(draftOfB.id)).toBe("DRAFT");
    expect({ a: await counts(a), b: await counts(b) }).toEqual(before);
  });
});

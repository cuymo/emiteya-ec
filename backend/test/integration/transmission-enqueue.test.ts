// Encolado del envío en la transacción que firma (add-sri-transmission, tarea 8.1, design D6): una
// factura firmada tiene su `sri.transmit` desde el mismo commit, y si esa transacción se cae no
// queda ni el SIGNED ni el job. Emite por HTTP con la firma sintética del arnés, sin el SRI.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { InvoiceView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

const bodyOf = (res: { body: unknown }) =>
  (res.body as { data: InvoiceView & { id: string } }).data;

describe("encolado del envío al firmar", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let company: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  async function emit(): Promise<InvoiceView> {
    const draft = await request(api.app)
      .post("/api/v1/invoices/drafts")
      .set("Cookie", company.cookies.operator)
      .send({
        emissionPointId: company.emissionPointId,
        buyerPartyId: company.customerId,
        lines: [{ productId: company.productId, quantity: "1" }],
        payments: [{ paymentMethod: "01" }],
      });
    const res = await request(api.app)
      .post("/api/v1/invoices")
      .set("Cookie", company.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: bodyOf(draft).id, expectedVersion: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res);
  }
  const jobsOf = (documentId: string) =>
    db.database.prisma.job.findMany({ where: { documentId }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    db = await createMigratedSchema("transmission_enqueue");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    company = await readyCompany(api, db, { slug: "a", pool, p12Dir: inject("p12FixturesDir") });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("la factura firmada tiene su sri.transmit desde el mismo commit", async () => {
    const invoice = await emit();
    expect(invoice.state).toBe("SIGNED");
    const [job] = await jobsOf(invoice.id);
    expect(job).toMatchObject({
      type: "sri.transmit",
      status: "PENDING",
      dedupeKey: `sri.transmit:${invoice.id}`,
      activeSriDocumentId: invoice.id,
      origin: "AUTOMATIC",
      maxAttempts: 10,
    });
    expect(job!.deadlineAt!.getTime() - job!.scheduledAt.getTime()).toBe(24 * 3_600_000);
    expect(invoice.transmission).toMatchObject({ inProgress: true, reconcilable: false });
  });

  it("si la transacción que firma se cae, no quedan ni el SIGNED ni el job; el reintento crea ambos", async () => {
    const prisma = db.database.prisma;
    const schema = `"${db.name}"`;
    // Una caída simulada al insertar el job, dentro de la transacción que firma.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${schema}.job_insert_fails() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'caída simulada'; END; $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER job_insert_fails BEFORE INSERT ON ${schema}."job" FOR EACH ROW EXECUTE FUNCTION ${schema}.job_insert_fails()`,
    );
    let invoice: InvoiceView;
    try {
      invoice = await emit();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER job_insert_fails ON ${schema}."job"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${schema}.job_insert_fails()`);
    }
    expect(invoice.state).toBe("RESERVED");
    expect(invoice.diagnostic?.code).toBe("PERSIST_FAILED");
    expect(await jobsOf(invoice.id)).toEqual([]);
    expect(await prisma.documentArtifact.count({ where: { documentId: invoice.id } })).toBe(0);

    const retried = await request(api.app)
      .post(`/api/v1/invoices/${invoice.id}/signing-attempts`)
      .set("Cookie", company.cookies.operator);
    expect(bodyOf(retried).state).toBe("SIGNED");
    expect((await jobsOf(invoice.id)).map((job) => [job.type, job.status])).toEqual([
      ["sri.transmit", "PENDING"],
    ]);
  });
});

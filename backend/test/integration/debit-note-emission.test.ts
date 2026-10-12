// Emisión de notas de débito por HTTP (add-debit-notes, tarea 6.1, design D4, D8, D13 a D16, D22 y
// D24): una nota de un concepto y una de varias tarifas firmadas con su propio contador; los
// rechazos sin reservar número; la prueba negativa sin forma de pago; la forma de pago congelada
// aunque cambie el catálogo; el doble envío secuencial y simultáneo con una sola nota; la repetición
// que reanuda la firma; la clave reutilizada o ausente; la misma clave en una factura, una nota de
// crédito y una nota de débito; la auditoría y las métricas.
import { randomUUID } from "node:crypto";
import { Registry } from "@prometheus-io/client";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { DebitNoteDraftView, DebitNoteView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { DebitNoteSnapshot } from "../../src/modules/debit-notes/domain/snapshot.ts";
import { createDebitNoteDraftRepository } from "../../src/modules/debit-notes/infrastructure/prisma-drafts.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import {
  IVA0,
  insertAuthorizedInvoice,
  tamperSnapshot,
  type AuthorizedInvoiceDocument,
  type InvoiceCompany,
} from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: DebitNoteView & DebitNoteDraftView & { id: string; version: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const DECLARATIONS = { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] };
const CONCEPT = {
  cause: "LATE_PAYMENT_INTEREST" as const,
  description: "Intereses por 30 días de mora",
  amount: "20.00",
  taxTreatment: "2:4",
};
type App = ReturnType<typeof buildTaxpayerApp>;
const compact = (xml: string) => xml.replace(/>\s+</g, "><");

describe("emisión de notas de débito", () => {
  let db: MigratedSchema;
  let api: App;
  let reserving: App;
  let a: ReadyCompany;
  let unsigned: ReadyCompany;
  let good: string;
  let service: string;
  const registry = new Registry();
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const companyOf = (company: ReadyCompany): InvoiceCompany => ({
    companyId: company.companyId,
    adminId: company.adminId,
    establishmentId: company.establishmentId,
    emissionPointId: company.emissionPointId,
  });
  /** Factura autorizada de 10 × 10.00 al 15 % y 1 × 15.00 al 0 %. */
  const invoice = (company = a, options: { consumerFinal?: boolean } = {}) =>
    insertAuthorizedInvoice(
      db.database.prisma,
      companyOf(company),
      [
        { productId: good, quantity: "10", unitPrice: "10.00" },
        { productId: service, quantity: "1", unitPrice: "15.00", rate: IVA0 },
      ],
      options,
    );
  const draft = async (
    target: AuthorizedInvoiceDocument,
    overrides: Record<string, unknown> = {},
    company = a,
  ) => {
    const res = await request(api.app)
      .post("/api/v1/debit-notes/drafts")
      .set("Cookie", company.cookies.operator)
      .send({
        invoiceId: target.id,
        emissionPointId: company.emissionPointId,
        paymentMethod: "20",
        concepts: [CONCEPT],
        ...overrides,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (
    app: App,
    created: { id: string; version: number },
    key: string | null = randomUUID(),
    declarations: unknown = DECLARATIONS,
    company = a,
  ) => {
    const req = request(app.app)
      .post("/api/v1/debit-notes")
      .set("Cookie", company.cookies.operator);
    return (key === null ? req : req.set("Idempotency-Key", key)).send({
      draftId: created.id,
      expectedVersion: created.version,
      declarations,
    });
  };
  const trace = async () => ({
    notes: await db.database.prisma.electronicDocument.count({ where: { documentType: "05" } }),
    sequences: await db.database.prisma.fiscalSequenceReservation.count({
      where: { documentType: "05" },
    }),
    counters: (
      await db.database.prisma.fiscalSequence.findMany({
        where: { documentType: "05" },
        orderBy: { id: "asc" },
      })
    ).map((counter) => counter.nextNumber),
    supports: await db.database.prisma.debitNoteSupport.count(),
    audit: await db.database.prisma.auditEvent.count({
      where: { action: { startsWith: "debit_note." } },
    }),
    idempotency: await db.database.prisma.idempotencyRecord.count({
      where: { operation: "debit_note.emit" },
    }),
  });
  const signedXml = async (documentId: string) =>
    Buffer.from(
      (
        await db.database.prisma.documentArtifact.findFirstOrThrow({
          where: { documentId, kind: "SIGNED_XML" },
        })
      ).content,
    ).toString("utf8");
  const disablePayment = (company: ReadyCompany, entryKey: string) =>
    db.database.prisma.companyFiscalCatalogSetting.create({
      data: {
        companyId: company.companyId,
        catalogType: "payment-method",
        entryKey,
        enabled: false,
        updatedBy: company.adminId,
      },
    });
  const metric = async (name: string) => (await registry.getSingleMetricAsString(name)) ?? "";

  beforeAll(async () => {
    db = await createMigratedSchema("debit_note_emission");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      debitNotes: { metrics: registry },
    });
    reserving = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      debitNotes: { signAfterReserve: false },
    });
    a = await readyCompany(api, db, { slug: "emision-nd", pool, p12Dir: inject("p12FixturesDir") });
    unsigned = await readyCompany(api, db, { slug: "emision-nd-sin-firma" });
    const fiscal = { companyId: a.companyId, adminId: a.adminId, points: [] };
    good = await insertProduct(db.database.prisma, fiscal, { name: "Cemento 50 kg" });
    service = await insertProduct(db.database.prisma, fiscal, {
      kind: "SERVICE",
      stockTracked: false,
    });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("una nota de un concepto y una de varias tarifas quedan firmadas con su propio contador", async () => {
    const first = await invoice();
    const single = await emit(api, await draft(first));
    expect(single.status, JSON.stringify(single.body)).toBe(201);
    const note = bodyOf(single).data;
    expect(note).toMatchObject({
      documentType: "05",
      state: "SIGNED",
      documentNumber: "001-001-000000001",
      invoice: { id: first.id, documentNumber: first.documentNumber, accessKey: first.accessKey },
      totals: { withoutTaxes: "20.00", total: "23.00" },
      payment: { entryKey: "20", code: "20", amount: "23.00" },
    });
    expect(note.accessKey.slice(8, 10)).toBe("05");
    expect(note.concepts).toEqual([
      {
        position: 1,
        cause: "LATE_PAYMENT_INTEREST",
        description: "Intereses por 30 días de mora",
        amount: "20.00",
        taxTreatment: {
          key: "2:4",
          taxCode: "2",
          rateCode: "4",
          percentage: "15",
          label: "IVA 15 %",
        },
      },
    ]);
    expect(note.declarations).toMatchObject({
      version: 1,
      basis: "USER_DECLARED",
      declaredBy: a.operatorId,
      statements: [{ id: "NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE" }],
    });

    const second = await invoice();
    const mixed = await emit(
      api,
      await draft(second, {
        concepts: [
          { ...CONCEPT, amount: "50.00" },
          {
            cause: "POST_INVOICE_COST_EXPENSE",
            description: "Flete posterior a la venta",
            amount: "20.00",
            taxTreatment: "2:0",
          },
        ],
      }),
    );
    expect(mixed.status, JSON.stringify(mixed.body)).toBe(201);
    expect(bodyOf(mixed).data).toMatchObject({
      documentNumber: "001-001-000000002",
      totals: {
        withoutTaxes: "70.00",
        taxes: [
          { key: "2:0", base: "20.00", amount: "0.00" },
          { key: "2:4", base: "50.00", amount: "7.50" },
        ],
        total: "77.50",
      },
    });
    // La numeración de la nota no comparte contador con la factura.
    const next = await invoice();
    expect(Number(next.documentNumber.slice(-9))).toBe(Number(second.documentNumber.slice(-9)) + 1);

    // El XML firmado declara el tipo 05, el comprobante modificado y la única forma de pago.
    const artifact = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: note.id, kind: "SIGNED_XML" },
    });
    expect(artifact.metadata).toMatchObject({
      documentType: "05",
      schemaPath: "sri-xsd/NotaDebito_V1.0.0.xsd",
    });
    const xml = compact(await signedXml(note.id));
    expect(xml).toContain(`<numDocModificado>${first.documentNumber}</numDocModificado>`);
    expect(xml).toContain("<codDocModificado>01</codDocModificado>");
    expect(xml).toContain("<valorTotal>23.00</valorTotal>");
    expect(xml).toContain(
      "<pagos><pago><formaPago>20</formaPago><total>23.00</total></pago></pagos>",
    );
    expect(xml).toContain(
      "<motivo><razon>Intereses por 30 días de mora</razon><valor>20.00</valor></motivo>",
    );
  });

  it("la vista previa, el snapshot, el XML y la consulta llevan los mismos importes, sin la declaración en el XML", async () => {
    const target = await invoice();
    const created = await draft(target, {
      concepts: [
        { ...CONCEPT, amount: "0.10" },
        { ...CONCEPT, description: "Interés del segundo mes", amount: "0.10" },
        { ...CONCEPT, description: "Interés del tercer mes", amount: "0.10" },
      ],
    });
    expect(created.preview.totals).toMatchObject({ withoutTaxes: "0.30", total: "0.35" });
    const res = await emit(api, created);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const note = bodyOf(res).data;
    const stored = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: note.id },
    });
    const snapshot = stored.snapshot as unknown as DebitNoteSnapshot;
    expect(snapshot.taxes).toEqual([
      { taxCode: "2", rateCode: "4", percentage: "15", base: "0.30", amount: "0.05" },
    ]);
    expect(snapshot.totals).toEqual({ withoutTaxes: "0.30", total: "0.35" });
    expect(snapshot.payments).toEqual([
      expect.objectContaining({ code: "20", amount: "0.35", catalogType: "payment-method" }),
    ]);
    expect(snapshot.invoice.taxTreatments.map((t) => t.key)).toEqual(["2:0", "2:4"]);
    expect(note.totals).toMatchObject({ withoutTaxes: "0.30", total: "0.35" });
    const xml = compact(await signedXml(note.id));
    expect(xml).toContain("<baseImponible>0.30</baseImponible><valor>0.05</valor>");
    expect(xml).toContain("<valorTotal>0.35</valorTotal>");
    expect(xml).not.toContain("NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE");
  });

  it("la forma de pago queda congelada al reservar aunque después cambie el catálogo", async () => {
    const target = await invoice();
    const created = await draft(target, { paymentMethod: "17" });
    const reserved = await emit(reserving, created);
    expect([reserved.status, bodyOf(reserved).data.state]).toEqual([201, "RESERVED"]);
    // Después de reservar, la forma de pago se deshabilita para la empresa.
    await disablePayment(a, "17");
    const retried = await request(api.app)
      .post(`/api/v1/debit-notes/${bodyOf(reserved).data.id}/signing-attempts`)
      .set("Cookie", a.cookies.operator);
    expect([retried.status, bodyOf(retried).data.state]).toEqual([200, "SIGNED"]);
    expect(bodyOf(retried).data.payment).toMatchObject({ code: "17", amount: "23.00" });
    expect(compact(await signedXml(bodyOf(reserved).data.id))).toContain(
      "<pagos><pago><formaPago>17</formaPago><total>23.00</total></pago></pagos>",
    );
  });

  it("prueba negativa: una nota sin forma de pago no queda reservada, no consume secuencial y no recibe clave", async () => {
    const target = await invoice();
    const created = await draft(target, { paymentMethod: null });
    const before = await trace();
    const res = await emit(api, created);
    expect([res.status, bodyOf(res).error.code]).toEqual([409, "DEBIT_NOTE_DRAFT_INCOMPLETE"]);
    expect(bodyOf(res).error.message).toBe("Elige la forma de pago de la nota de débito.");
    expect(await trace()).toEqual(before);
    expect(
      await db.database.prisma.debitNoteDraft.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({ status: "DRAFT", documentId: null });
  });

  it("rechaza sin reservar número ni auditar: factura alterada, consumidor final, concepto, tratamiento, forma de pago, declaración y empresa no preparada", async () => {
    const before = await trace();
    const rejected = (res: request.Response, code: string, status = 409) => {
      expect([res.status, bodyOf(res).error.code], code).toEqual([status, code]);
      return bodyOf(res).error;
    };

    const altered = await invoice();
    const alteredDraft = await draft(altered);
    await tamperSnapshot(db.database.prisma, db.name, altered.id, (snapshot) => ({
      ...snapshot,
      totals: { ...(snapshot.totals as Record<string, unknown>), total: "1.00" },
    }));
    rejected(await emit(api, alteredDraft), "DEBIT_NOTE_INVOICE_INTEGRITY");

    // Un borrador guardado directamente para una factura a consumidor final: la emisión también
    // lo rechaza, por política del proyecto.
    const consumer = await invoice(a, { consumerFinal: true });
    const consumerDraft = await createDebitNoteDraftRepository(db.database.prisma).create(
      a.companyId,
      consumer.id,
      { emissionPointId: a.emissionPointId, paymentMethod: "20", concepts: [CONCEPT] },
      a.operatorId,
    );
    const consumerError = rejected(await emit(api, consumerDraft), "DEBIT_NOTE_CONSUMER_FINAL");
    expect(consumerError.message).toMatch(/política del sistema/);

    const target = await invoice();
    rejected(
      await emit(api, await draft(target, { concepts: [{ ...CONCEPT, amount: null }] })),
      "DEBIT_NOTE_DRAFT_INCOMPLETE",
    );
    rejected(
      await emit(api, await draft(target, { concepts: [{ ...CONCEPT, taxTreatment: "2:2" }] })),
      "DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE",
    );
    const paymentDraft = await draft(target, { paymentMethod: "16" });
    await disablePayment(a, "16");
    rejected(await emit(api, paymentDraft), "DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE");

    const valid = await draft(target);
    const withoutDeclaration = await request(api.app)
      .post("/api/v1/debit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: valid.id, expectedVersion: valid.version });
    rejected(withoutDeclaration, "VALIDATION_ERROR", 400);
    rejected(
      await emit(api, valid, randomUUID(), { ...DECLARATIONS, version: 2 }),
      "VALIDATION_ERROR",
      400,
    );
    rejected(
      await emit(api, valid, randomUUID(), { version: 1, statements: [] }),
      "VALIDATION_ERROR",
      400,
    );

    const unready = await invoice(unsigned);
    rejected(
      await emit(api, await draft(unready, {}, unsigned), randomUUID(), DECLARATIONS, unsigned),
      "SIGNING_CERTIFICATE_NOT_USABLE",
    );
    const anonymous = await request(api.app)
      .post("/api/v1/debit-notes")
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: valid.id, expectedVersion: valid.version, declarations: DECLARATIONS });
    expect(anonymous.status).toBe(401);
    // Ningún rechazo reservó número ni dejó relación, idempotencia o auditoría de la nota.
    expect(await trace()).toEqual(before);
  });

  it("el doble envío secuencial y simultáneo deja una sola nota; otra solicitud con la clave es un conflicto", async () => {
    const target = await invoice();
    const created = await draft(target);
    const key = randomUUID();
    const before = await trace();
    const [one, two] = await Promise.all([emit(api, created, key), emit(api, created, key)]);
    expect([one.status, two.status].sort()).toEqual([200, 201]);
    expect(bodyOf(one).data.id).toBe(bodyOf(two).data.id);
    const again = await emit(api, created, key);
    expect([again.status, bodyOf(again).data.id]).toEqual([200, bodyOf(one).data.id]);
    const after = await trace();
    expect([
      after.notes - before.notes,
      after.sequences - before.sequences,
      after.supports - before.supports,
      after.idempotency - before.idempotency,
    ]).toEqual([1, 1, 1, 1]);

    // La misma clave con otro borrador es un conflicto y el otro borrador sigue sin emitir.
    const other = await draft(target, { concepts: [{ ...CONCEPT, amount: "5.00" }] });
    const reused = await emit(api, other, key);
    expect([reused.status, bodyOf(reused).error.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    expect(
      (await db.database.prisma.debitNoteDraft.findUniqueOrThrow({ where: { id: other.id } }))
        .status,
    ).toBe("DRAFT");
    // El borrador emitido con otra clave: ya se emitió.
    const twice = await emit(api, created, randomUUID());
    expect([twice.status, bodyOf(twice).error.code]).toEqual([
      409,
      "DEBIT_NOTE_DRAFT_ALREADY_EMITTED",
    ]);
    // Sin clave, nada se emite.
    const keyless = await emit(api, other, null);
    expect([keyless.status, bodyOf(keyless).error.code]).toEqual([400, "IDEMPOTENCY_KEY_REQUIRED"]);
  });

  it("la repetición de una nota que quedó reservada reanuda su firma sin otro número", async () => {
    const target = await invoice();
    const created = await draft(target);
    const key = randomUUID();
    const reserved = await emit(reserving, created, key);
    expect([reserved.status, bodyOf(reserved).data.state]).toEqual([201, "RESERVED"]);
    const before = await trace();
    const resumed = await emit(api, created, key);
    expect([resumed.status, bodyOf(resumed).data.state]).toEqual([200, "SIGNED"]);
    expect(bodyOf(resumed).data).toMatchObject({
      id: bodyOf(reserved).data.id,
      documentNumber: bodyOf(reserved).data.documentNumber,
      accessKey: bodyOf(reserved).data.accessKey,
    });
    const after = await trace();
    expect([after.notes, after.sequences, after.supports, after.idempotency]).toEqual([
      before.notes,
      before.sequences,
      before.supports,
      before.idempotency,
    ]);
  });

  it("la misma clave en una factura, una nota de crédito y una nota de débito emite las tres", async () => {
    const key = randomUUID();
    const invoiceDraft = await request(api.app)
      .post("/api/v1/invoices/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        emissionPointId: a.emissionPointId,
        buyerPartyId: a.customerId,
        lines: [{ productId: a.productId, quantity: "1", discount: "0" }],
        payments: [{ paymentMethod: "01" }],
      });
    const emittedInvoice = await request(api.app)
      .post("/api/v1/invoices")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", key)
      .send({
        draftId: bodyOf(invoiceDraft).data.id,
        expectedVersion: bodyOf(invoiceDraft).data.version,
      });
    expect(emittedInvoice.status).toBe(201);
    const creditTarget = await invoice();
    const creditDraft = await request(api.app)
      .post("/api/v1/credit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: creditTarget.id,
        emissionPointId: a.emissionPointId,
        cause: "RETURN",
        reason: "Devolución",
        lines: [{ position: 2, quantity: "1" }],
      });
    expect(creditDraft.status, JSON.stringify(creditDraft.body)).toBe(201);
    const creditNote = await request(api.app)
      .post("/api/v1/credit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", key)
      .send({
        draftId: bodyOf(creditDraft).data.id,
        expectedVersion: bodyOf(creditDraft).data.version,
        declarations: {
          version: 1,
          statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
        },
      });
    expect(creditNote.status, JSON.stringify(creditNote.body)).toBe(201);
    const debitNote = await emit(api, await draft(await invoice()), key);
    expect(debitNote.status, JSON.stringify(debitNote.body)).toBe(201);
  });

  it("audita la reserva y la firma con la factura, las causas y la declaración, sin descripciones", async () => {
    const target = await invoice();
    const res = await emit(
      api,
      await draft(target, {
        concepts: [
          CONCEPT,
          {
            cause: "POST_INVOICE_COST_EXPENSE",
            description: "Flete posterior a la venta",
            amount: "5.00",
            taxTreatment: "2:0",
          },
        ],
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const note = bodyOf(res).data;
    const events = await db.database.prisma.auditEvent.findMany({
      where: { companyId: a.companyId, action: { startsWith: "debit_note." } },
      orderBy: { occurredAt: "asc" },
    });
    const own = events.filter(
      (event) => (event.changes as { debitNoteId?: string }).debitNoteId === note.id,
    );
    expect(own.map((event) => [event.action, event.actorUserId])).toEqual([
      ["debit_note.reserved", a.operatorId],
      ["debit_note.signed", a.operatorId],
    ]);
    expect(own[0]!.changes).toEqual({
      debitNoteId: note.id,
      documentNumber: note.documentNumber,
      accessKey: note.accessKey,
      environment: "TEST",
      total: "28",
      invoiceId: target.id,
      invoiceNumber: target.documentNumber,
      causes: ["LATE_PAYMENT_INTEREST", "POST_INVOICE_COST_EXPENSE"],
      conceptCount: 2,
      declarationVersion: 1,
      declarations: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"],
    });
    expect(JSON.stringify(own.map((event) => event.changes))).not.toContain("Flete");
    expect(await metric("debit_note_reservations_total")).toMatch(
      /debit_note_reservations_total \d+/,
    );
    expect(await metric("debit_note_concepts_total")).toContain(
      'cause="POST_INVOICE_COST_EXPENSE"',
    );
  });
});

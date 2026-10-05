// Emisión de notas de crédito por HTTP (add-credit-notes, tarea 8.2, design D4, D7, D10, D11, D18,
// D20 y D24): devolución parcial, devolución total y anulación total firmadas con su propio
// contador; los rechazos sin reservar número; el doble envío secuencial y simultáneo con una sola
// nota y una sola reserva; la repetición que reanuda la firma; la clave reutilizada; la misma clave
// en una factura y en una nota; el snapshot autosuficiente; la auditoría y las métricas.
import { randomUUID } from "node:crypto";
import { Registry } from "@prometheus-io/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CreditNoteDraftView, CreditNoteView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { CreditNoteSnapshot } from "../../src/modules/credit-notes/domain/snapshot.ts";
import { reconcileCreditCapacity } from "../../src/modules/credit-notes/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import {
  IVA0,
  insertAuthorizedInvoice,
  insertCreditNote,
  recordOutflow,
  tamperSnapshot,
  type AuthorizedInvoiceDocument,
  type InvoiceCompany,
} from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: CreditNoteView & CreditNoteDraftView & { id: string; version: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};
type App = ReturnType<typeof buildTaxpayerApp>;

describe("emisión de notas de crédito", () => {
  let db: MigratedSchema;
  let api: App;
  let reserving: App;
  let a: ReadyCompany;
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
  /** Factura autorizada de 10 × 10.00 (bien con salida de 10) y 1 × 15.00 (servicio sin IVA). */
  const invoice = async () => {
    const created = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "10", unitPrice: "10.00", inventoryAffectsStock: true },
      { productId: service, quantity: "1", unitPrice: "15.00", rate: IVA0 },
    ]);
    await recordOutflow(db.database.prisma, a, created, good, "10");
    return created;
  };
  const draft = async (
    target: AuthorizedInvoiceDocument,
    overrides: Record<string, unknown> = {},
  ) => {
    const res = await request(api.app)
      .post("/api/v1/credit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: target.id,
        emissionPointId: a.emissionPointId,
        cause: "RETURN",
        reason: "Devolución de mercadería",
        lines: [{ position: 1, quantity: "2", physicalReturn: "1" }],
        ...overrides,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (
    app: App,
    created: { id: string; version: number },
    key: string = randomUUID(),
    declarations: unknown = DECLARATIONS,
  ) =>
    request(app.app)
      .post("/api/v1/credit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", key)
      .send({ draftId: created.id, expectedVersion: created.version, declarations });
  const trace = async () => ({
    notes: await db.database.prisma.electronicDocument.count({ where: { documentType: "04" } }),
    sequences: await db.database.prisma.fiscalSequenceReservation.count({
      where: { documentType: "04" },
    }),
    reservations: await db.database.prisma.creditReservation.count(),
    returns: await db.database.prisma.stockReturnReservation.count(),
    audit: await db.database.prisma.auditEvent.count({ where: { action: "credit_note.reserved" } }),
    idempotency: await db.database.prisma.idempotencyRecord.count({
      where: { operation: "credit_note.emit" },
    }),
  });
  const metric = async (name: string) => (await registry.getSingleMetricAsString(name)) ?? "";

  beforeAll(async () => {
    db = await createMigratedSchema("credit_note_emission");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      creditNotes: { metrics: registry },
    });
    reserving = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      creditNotes: { signAfterReserve: false },
    });
    a = await readyCompany(api, db, { slug: "emision-nc", pool, p12Dir: inject("p12FixturesDir") });
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

  it("devolución parcial, devolución total y anulación total quedan firmadas con su propio contador", async () => {
    const first = await invoice();
    const partial = await emit(api, await draft(first));
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    const note = bodyOf(partial).data;
    expect(note).toMatchObject({
      documentType: "04",
      state: "SIGNED",
      documentNumber: "001-001-000000001",
      cause: "RETURN",
      invoice: { id: first.id, documentNumber: first.documentNumber },
      totals: { withoutTaxes: "20.00", total: "23.00" },
    });
    expect(note.accessKey.slice(8, 10)).toBe("04");
    expect(note.lines).toMatchObject([{ position: 1, quantity: "2", physicalReturn: "1" }]);
    expect(note.declarations).toMatchObject({
      version: 1,
      basis: "USER_DECLARED",
      declaredBy: a.operatorId,
    });

    const second = await invoice();
    const total = await emit(
      api,
      await draft(second, {
        lines: [
          { position: 1, quantity: "10", physicalReturn: "0" },
          { position: 2, quantity: "1", physicalReturn: "0" },
        ],
      }),
    );
    expect([
      total.status,
      bodyOf(total).data.documentNumber,
      bodyOf(total).data.totals.total,
    ]).toEqual([201, "001-001-000000002", "130.00"]);
    const third = await invoice();
    const annulment = await emit(api, await draft(third, { cause: "TOTAL_ANNULMENT", lines: [] }));
    expect([
      annulment.status,
      bodyOf(annulment).data.documentNumber,
      bodyOf(annulment).data.totals.total,
    ]).toEqual([201, "001-001-000000003", third.total]);
    // La numeración de la nota no comparte contador con la factura.
    const next = await invoice();
    expect(Number(next.documentNumber.slice(-9))).toBe(Number(third.documentNumber.slice(-9)) + 1);

    // El XML firmado declara el tipo 04 y el comprobante modificado.
    const artifact = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: note.id, kind: "SIGNED_XML" },
    });
    expect(artifact.metadata).toMatchObject({
      documentType: "04",
      schemaPath: "sri-xsd/NotaCredito_V1.1.0.xsd",
    });
    const xml = Buffer.from(artifact.content).toString("utf8");
    expect(xml).toContain(`<numDocModificado>${first.documentNumber}</numDocModificado>`);
    expect(xml).toContain("<codDocModificado>01</codDocModificado>");
    expect(xml).toContain("<valorModificacion>23.00</valorModificacion>");
    expect(await reconcileCreditCapacity(db.database.prisma, a.companyId)).toEqual([]);
  });

  it("congela en el snapshot todo lo que la nota necesita, sin releer la factura", async () => {
    const target = await invoice();
    const res = await emit(api, await draft(target));
    const document = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: bodyOf(res).data.id },
    });
    const snapshot = document.snapshot as unknown as CreditNoteSnapshot;
    expect(snapshot).toMatchObject({
      snapshotVersion: 1,
      calculationVersion: 1,
      schema: { documentType: "04", version: "1.1.0" },
      cause: "RETURN",
      reason: "Devolución de mercadería",
      invoice: {
        id: target.id,
        documentType: "01",
        documentNumber: target.documentNumber,
        accessKey: target.accessKey,
        authorizationNumber: target.accessKey,
        environment: "TEST",
        snapshotVersion: 2,
      },
      buyer: { identification: "0992877878001", legalName: "EL PERNO CIA. LTDA." },
      lines: [
        {
          position: 1,
          invoicePosition: 1,
          productId: good,
          quantity: "2",
          unitPrice: "10.00",
          taxableBase: "20.00",
          physicalReturn: "1",
          inventoryAffectsStock: true,
        },
      ],
      totals: { total: "23.00" },
      declarations: {
        version: 1,
        statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
        declaredBy: a.operatorId,
        basis: "USER_DECLARED",
      },
      key: { accessKey: document.accessKey, documentNumber: document.documentNumber },
    });
    expect(snapshot.lines[0]!.taxes[0]).toMatchObject({
      catalogType: "iva-rate",
      percentage: "15",
      amount: "3.00",
    });
  });

  it("la vista previa, el snapshot y el XML llevan los mismos importes y el comprador de la factura, sin el retorno ni las declaraciones en el XML", async () => {
    const target = await invoice();
    // El tercero cambió su razón social después de facturar: la nota lleva la de la factura.
    await db.database.prisma.party.update({
      where: { id: a.customerId },
      data: { legalName: "FERRETERÍA EL PERNO RENOVADA S.A.", searchName: "ferreteria" },
    });
    const created = await draft(target, {
      lines: [
        { position: 1, quantity: "3", physicalReturn: "2" },
        { position: 2, quantity: "1", physicalReturn: "0" },
      ],
    });
    const before = new Date();
    const res = await emit(api, created);
    const after = new Date();
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const document = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: bodyOf(res).data.id },
    });
    const snapshot = document.snapshot as unknown as CreditNoteSnapshot;
    expect(snapshot.buyer.legalName).toBe("EL PERNO CIA. LTDA.");
    // Un solo cálculo: la vista previa del borrador y el snapshot de la nota coinciden.
    expect(snapshot.totals).toMatchObject(created.preview.totals!);
    expect(
      snapshot.lines.map(({ position, quantity, discount, taxableBase }) => ({
        position,
        quantity,
        discount,
        taxableBase,
      })),
    ).toEqual(
      created.preview.lines.map(({ position, quantity, discount, taxableBase }) => ({
        position,
        quantity,
        discount,
        taxableBase,
      })),
    );
    // Las declaraciones guardan el usuario y el momento de la emisión.
    const declaredAt = new Date(snapshot.declarations.declaredAt);
    expect(declaredAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(declaredAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    // El XML lleva los mismos importes y el comprador de la factura, y no el retorno ni las
    // declaraciones, que no forman parte del comprobante.
    const signed = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: document.id, kind: "SIGNED_XML" },
    });
    const xml = Buffer.from(signed.content).toString("utf8");
    expect(xml).toContain("<razonSocialComprador>EL PERNO CIA. LTDA.</razonSocialComprador>");
    expect(xml).not.toContain("RENOVADA");
    expect(xml).toContain(`<valorModificacion>${snapshot.totals.total}</valorModificacion>`);
    expect(xml).toContain(`<totalSinImpuestos>${snapshot.totals.withoutTaxes}</totalSinImpuestos>`);
    for (const line of snapshot.lines) {
      expect(xml).toContain(`<precioTotalSinImpuesto>${line.taxableBase}</precioTotalSinImpuesto>`);
    }
    for (const absent of [
      "physicalReturn",
      "etorno",
      "NOT_NEGOTIATED",
      "NOT_TAX_REFUND",
      "Declaro",
    ]) {
      expect(xml).not.toContain(absent);
    }
  });

  it("una factura alterada o a consumidor final se rechaza sin reservar ni auditar, y emitir sin sesión responde 401", async () => {
    const target = await invoice();
    const created = await draft(target);
    // El snapshot de la factura se corrompe después de guardar el borrador.
    await tamperSnapshot(db.database.prisma, db.name, target.id, (snapshot) => ({
      ...snapshot,
      totals: { ...(snapshot.totals as Record<string, unknown>), total: "1.00" },
    }));
    const before = await trace();
    const noteAudit = () =>
      db.database.prisma.auditEvent.count({ where: { action: { startsWith: "credit_note." } } });
    const auditBefore = await noteAudit();
    const altered = await emit(api, created);
    expect([altered.status, bodyOf(altered).error.code]).toEqual([
      409,
      "CREDIT_NOTE_INVOICE_INTEGRITY",
    ]);
    // Nada se repara con los datos vigentes: el snapshot alterado sigue igual.
    const stored = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect((stored.snapshot as { totals: { total: string } }).totals.total).toBe("1.00");

    const consumerFinal = await insertAuthorizedInvoice(
      db.database.prisma,
      companyOf(a),
      [{ productId: good, quantity: "1", unitPrice: "10.00" }],
      { consumerFinal: true },
    );
    const refused = await request(api.app)
      .post("/api/v1/credit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: consumerFinal.id,
        emissionPointId: a.emissionPointId,
        cause: "RETURN",
        reason: "Devolución",
        lines: [{ position: 1, quantity: "1" }],
      });
    expect([refused.status, bodyOf(refused).error.code]).toEqual([
      409,
      "CREDIT_NOTE_CONSUMER_FINAL",
    ]);
    const anonymous = await request(api.app)
      .post("/api/v1/credit-notes")
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: created.id, expectedVersion: created.version, declarations: DECLARATIONS });
    expect(anonymous.status).toBe(401);
    // Ningún rechazo reservó número ni capacidad, ni dejó idempotencia o auditoría de la nota.
    expect(await trace()).toEqual(before);
    expect(await noteAudit()).toBe(auditBefore);
  });

  it("sin motivo, con un importe de línea negativo o con un crédito que superaría el total, se rechaza sin reservar número", async () => {
    const fiscal = {
      companyId: a.companyId,
      adminId: a.adminId,
      points: [
        { establishmentId: a.establishmentId, emissionPointId: a.emissionPointId, code: "001" },
      ],
    };
    // Sin motivo: el borrador se guarda, pero la emisión lo exige.
    const withoutReason = await draft(await invoice(), { reason: null });
    // 3 × 0.005 con descuento 0.01: la primera unidad acreditó la base entera y otra unidad daría
    // una base negativa.
    const tiny = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: service, quantity: "3", unitPrice: "0.005", discount: "0.01" },
    ]);
    await insertCreditNote(db.database.prisma, fiscal, tiny, {
      lines: [{ position: 1, quantity: "1" }],
    });
    const negative = await draft(tiny, { lines: [{ position: 1, quantity: "1" }] });
    expect(negative.preview.issues).toContainEqual(
      expect.objectContaining({ code: "CREDIT_NOTE_LINE_AMOUNT_NEGATIVE", line: 1 }),
    );
    // Una reserva previa de 125.00 sobre una factura de 130.00 deja 5.00: otra unidad de 11.50
    // haría superar el total.
    const nearlyFull = await invoice();
    await insertCreditNote(db.database.prisma, fiscal, nearlyFull, {
      lines: [{ position: 1, quantity: "1" }],
      amount: "125.00",
    });
    const exceeding = await draft(nearlyFull, {
      lines: [{ position: 2, quantity: "1", physicalReturn: "0" }],
    });
    expect(exceeding.preview.issues).toContainEqual(
      expect.objectContaining({ code: "CREDIT_NOTE_AMOUNT_EXCEEDED" }),
    );

    const before = await trace();
    for (const [created, code] of [
      [withoutReason, "CREDIT_NOTE_REASON_REQUIRED"],
      [negative, "CREDIT_NOTE_LINE_AMOUNT_NEGATIVE"],
      [exceeding, "CREDIT_NOTE_AMOUNT_EXCEEDED"],
    ] as const) {
      const res = await emit(api, created);
      expect([res.status, bodyOf(res).error.code]).toEqual([409, code]);
    }
    expect(await trace()).toEqual(before);
  });

  it("con el control del producto desactivado después de facturar, el retorno físico se acepta", async () => {
    const target = await invoice();
    await db.database.prisma.product.update({ where: { id: good }, data: { stockTracked: false } });
    try {
      const res = await emit(
        api,
        await draft(target, { lines: [{ position: 1, quantity: "2", physicalReturn: "2" }] }),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(bodyOf(res).data.lines).toMatchObject([{ position: 1, physicalReturn: "2" }]);
    } finally {
      await db.database.prisma.product.update({
        where: { id: good },
        data: { stockTracked: true },
      });
    }
  });

  it("rechaza sin reservar número: declaración faltante, cantidad excedida y retorno no permitido o excedido", async () => {
    const target = await invoice();
    // Una nota previa acredita 8 de las 10 unidades: quedan 2 acreditables.
    const prior = await emit(
      api,
      await draft(target, { lines: [{ position: 1, quantity: "8", physicalReturn: "0" }] }),
    );
    expect(prior.status).toBe(201);
    // Otra factura de 10 unidades cuya salida fue de 3: su retorno físico se limita a 3.
    const partialOutflow = await insertAuthorizedInvoice(db.database.prisma, companyOf(a), [
      { productId: good, quantity: "10", unitPrice: "10.00", inventoryAffectsStock: true },
    ]);
    await recordOutflow(db.database.prisma, a, partialOutflow, good, "3");
    const drafts = {
      missing: await draft(target),
      exceeded: await draft(target, {
        lines: [{ position: 1, quantity: "3", physicalReturn: "0" }],
      }),
      service: await draft(target, {
        lines: [{ position: 2, quantity: "1", physicalReturn: "1" }],
      }),
      returned: await draft(partialOutflow, {
        lines: [{ position: 1, quantity: "4", physicalReturn: "4" }],
      }),
    };
    const before = await trace();

    const missing = await emit(api, drafts.missing, randomUUID(), {
      version: 1,
      statements: ["NOT_TAX_REFUND_SUPPORT"],
    });
    expect(missing.status).toBe(400);
    const exceeded = await emit(api, drafts.exceeded);
    expect([exceeded.status, bodyOf(exceeded).error.code]).toEqual([
      409,
      "CREDIT_NOTE_QUANTITY_EXCEEDED",
    ]);
    expect(bodyOf(exceeded).error.message).toContain("quedan 2");
    const service = await emit(api, drafts.service);
    expect([service.status, bodyOf(service).error.code]).toEqual([
      409,
      "CREDIT_NOTE_PHYSICAL_RETURN_INVALID",
    ]);
    const returned = await emit(api, drafts.returned);
    expect([returned.status, bodyOf(returned).error.code]).toEqual([
      409,
      "CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED",
    ]);
    expect(bodyOf(returned).error.message).toContain("quedan 3");

    // Ningún rechazo consumió número, capacidad, idempotencia ni auditoría.
    expect(await trace()).toEqual(before);
    const conflicts = await metric("credit_note_reservation_conflicts_total");
    expect(conflicts).toContain('reason="QUANTITY"');
    expect(conflicts).toContain('reason="PHYSICAL_RETURN"');
    expect(await reconcileCreditCapacity(db.database.prisma, a.companyId)).toEqual([]);
  });

  it("el doble envío secuencial y simultáneo deja una sola nota y una sola reserva", async () => {
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
      after.reservations - before.reservations,
      after.returns - before.returns,
    ]).toEqual([1, 1, 1, 1]);

    // La misma clave con otro borrador es un conflicto y el otro borrador sigue sin emitir.
    const other = await draft(target, {
      lines: [{ position: 1, quantity: "1", physicalReturn: "0" }],
    });
    const reused = await emit(api, other, key);
    expect([reused.status, bodyOf(reused).error.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    const still = await db.database.prisma.creditNoteDraft.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(still.status).toBe("DRAFT");
    // Las mismas declaraciones en otro orden son la misma solicitud: la huella las trata como conjunto.
    const reordered = await emit(api, created, key, {
      version: 1,
      statements: [...DECLARATIONS.statements].reverse(),
    });
    expect(reordered.status).toBe(200);
  });

  it("la repetición de una nota que quedó reservada reanuda su firma sin otro número ni otra capacidad", async () => {
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
    expect(await trace()).toEqual(before);
  });

  it("la misma clave en una factura y en una nota emite las dos", async () => {
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
    const note = await emit(api, await draft(await invoice()), key);
    expect(note.status, JSON.stringify(note.body)).toBe(201);
  });

  it("audita la reserva y la firma con la causa, la factura y las declaraciones", async () => {
    const target = await invoice();
    const res = await emit(api, await draft(target));
    const note = bodyOf(res).data;
    const events = await db.database.prisma.auditEvent.findMany({
      where: { companyId: a.companyId, action: { startsWith: "credit_note." } },
      orderBy: { occurredAt: "asc" },
    });
    const own = events.filter(
      (event) => (event.changes as { creditNoteId?: string }).creditNoteId === note.id,
    );
    expect(own.map((event) => [event.action, event.actorUserId])).toEqual([
      ["credit_note.reserved", a.operatorId],
      ["credit_note.signed", a.operatorId],
    ]);
    expect(own[0]!.changes).toEqual({
      creditNoteId: note.id,
      documentNumber: note.documentNumber,
      accessKey: note.accessKey,
      environment: "TEST",
      total: "23",
      invoiceId: target.id,
      invoiceNumber: target.documentNumber,
      cause: "RETURN",
      declarationVersion: 1,
      declarations: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
      lineCount: 1,
      physicalReturn: true,
    });
    expect(await metric("credit_note_reservations_total")).toContain('cause="RETURN"');
  });
});

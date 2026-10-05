// API de borradores de nota de crédito y facturas elegibles (add-credit-notes, tarea 8.1, design D4,
// D5 y D16): la factura en cada estado no autorizado y la de consumidor final se rechazan, la
// integridad se informa como problema que bloquea, la anulación total no elige líneas, la vista
// previa muestra los remanentes y los problemas por línea y se recalcula tras otra nota reservada;
// sin sesión `401` y otra empresa `404`; una factura de otro ambiente que el de la empresa no se emite.
// Un borrador no reserva capacidad ni número.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  CreditNoteDraftSummaryView,
  CreditNoteDraftView,
  EligibleInvoiceView,
} from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { corruptArtifact } from "./archive-harness.ts";
import {
  IVA0,
  insertAuthorizedInvoice,
  recordOutflow,
  type InvoiceCompany,
} from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: CreditNoteDraftView & CreditNoteDraftSummaryView[] & EligibleInvoiceView[];
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};

describe("API de borradores de nota de crédito", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let good: string;
  let service: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const call = (cookie: string, method: "get" | "post" | "put" | "delete", path: string) =>
    request(api.app)[method](`/api/v1${path}`).set("Cookie", cookie);
  const companyOf = (company: ReadyCompany): InvoiceCompany => ({
    companyId: company.companyId,
    adminId: company.adminId,
    establishmentId: company.establishmentId,
    emissionPointId: company.emissionPointId,
  });
  /**
   * Factura de 10 × 10.00 de un bien con inventario y 1 × 15.00 de un servicio sin IVA; autorizada,
   * con la salida de inventario del bien.
   */
  const invoice = async (
    company = a,
    options: { consumerFinal?: boolean; state?: string } = {},
  ) => {
    const created = await insertAuthorizedInvoice(
      db.database.prisma,
      companyOf(company),
      [
        { productId: good, quantity: "10", unitPrice: "10.00", inventoryAffectsStock: true },
        { productId: service, quantity: "1", unitPrice: "15.00", rate: IVA0 },
      ],
      options,
    );
    if ((options.state ?? "AUTHORIZED") === "AUTHORIZED" && company === a) {
      await recordOutflow(db.database.prisma, company, created, good, "10");
    }
    return created;
  };
  const draftBody = (invoiceId: string, overrides: Record<string, unknown> = {}) => ({
    invoiceId,
    emissionPointId: a.emissionPointId,
    cause: "RETURN",
    reason: "Devolución de mercadería",
    lines: [{ position: 1, quantity: "2", physicalReturn: "0" }],
    ...overrides,
  });
  const createDraft = async (invoiceId: string, overrides: Record<string, unknown> = {}) => {
    const res = await call(a.cookies.operator, "post", "/credit-notes/drafts").send(
      draftBody(invoiceId, overrides),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const fiscalTrace = async () => ({
    notes: await db.database.prisma.electronicDocument.count({ where: { documentType: "04" } }),
    capacities: await db.database.prisma.creditCapacity.count(),
    reservations: await db.database.prisma.fiscalSequenceReservation.count({
      where: { documentType: "04" },
    }),
  });

  beforeAll(async () => {
    db = await createMigratedSchema("credit_note_drafts_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "notas-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "notas-b", pool, p12Dir });
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

  it("una factura en un estado no autorizado se rechaza al preparar la nota", async () => {
    for (const state of [
      "RESERVED",
      "SIGNED",
      "RECEIVED",
      "SEND_UNKNOWN",
      "MANUAL_REVIEW",
      "RETURNED",
      "NOT_AUTHORIZED",
    ]) {
      const target = await invoice(a, { state });
      const res = await call(a.cookies.operator, "post", "/credit-notes/drafts").send(
        draftBody(target.id),
      );
      expect([res.status, bodyOf(res).error.code], state).toEqual([
        409,
        "CREDIT_NOTE_INVOICE_NOT_ELIGIBLE",
      ]);
      expect(bodyOf(res).error.message, state).toBe(
        "Solo una factura autorizada admite nota de crédito.",
      );
    }
  });

  it("una factura a consumidor final se rechaza sin reservar nada", async () => {
    const before = await fiscalTrace();
    const target = await invoice(a, { consumerFinal: true });
    const res = await call(a.cookies.operator, "post", "/credit-notes/drafts").send(
      draftBody(target.id),
    );
    expect([res.status, bodyOf(res).error.code]).toEqual([409, "CREDIT_NOTE_CONSUMER_FINAL"]);
    expect(await fiscalTrace()).toEqual(before);
  });

  it("la vista previa muestra los importes, lo acreditable que queda y el retorno permitido", async () => {
    const target = await invoice();
    const before = await fiscalTrace();
    const draft = await createDraft(target.id, {
      lines: [
        { position: 1, quantity: "2", physicalReturn: "1" },
        { position: 2, quantity: "1", physicalReturn: "0" },
      ],
    });
    expect(draft.invoice).toMatchObject({
      id: target.id,
      documentNumber: target.documentNumber,
      total: "130.00",
    });
    expect(draft.preview.issues).toEqual([]);
    expect(
      draft.preview.lines.map((l) => [
        l.position,
        l.quantity,
        l.taxableBase,
        l.physicalReturnAllowed,
        l.remainingQuantity,
      ]),
    ).toEqual([
      [1, "2", "20.00", true, "8"],
      [2, "1", "15.00", false, "0"],
    ]);
    expect(draft.preview.totals).toEqual({
      withoutTaxes: "35.00",
      taxes: [
        { taxCode: "2", rateCode: "0", percentage: "0", base: "15.00", amount: "0.00" },
        { taxCode: "2", rateCode: "4", percentage: "15", base: "20.00", amount: "3.00" },
      ],
      total: "38.00",
    });
    // Un borrador no reserva capacidad ni número.
    expect(await fiscalTrace()).toEqual(before);
  });

  it("lista los problemas junto a su línea y bloquea la emisión", async () => {
    const target = await invoice();
    const draft = await createDraft(target.id, {
      lines: [
        { position: 1, quantity: "11", physicalReturn: "0" },
        { position: 2, quantity: "1", physicalReturn: "1" },
      ],
    });
    expect(draft.preview.totals).toBeNull();
    expect(draft.preview.issues.map((i) => [i.code, i.line])).toEqual([
      ["CREDIT_NOTE_PHYSICAL_RETURN_INVALID", 2],
      ["CREDIT_NOTE_QUANTITY_EXCEEDED", 1],
    ]);
    const emit = await call(a.cookies.operator, "post", "/credit-notes")
      .set("Idempotency-Key", `bloqueada-${draft.id}`)
      .send({ draftId: draft.id, expectedVersion: draft.version, declarations: DECLARATIONS });
    expect([emit.status, bodyOf(emit).error.code]).toEqual([
      409,
      "CREDIT_NOTE_PHYSICAL_RETURN_INVALID",
    ]);
  });

  it("una línea ajena a la factura o un punto de otra empresa se rechazan al guardar", async () => {
    const target = await invoice();
    const foreignLine = await call(a.cookies.operator, "post", "/credit-notes/drafts").send(
      draftBody(target.id, { lines: [{ position: 3, quantity: "1", physicalReturn: "0" }] }),
    );
    expect([foreignLine.status, bodyOf(foreignLine).error.code]).toEqual([
      400,
      "CREDIT_NOTE_LINE_INVALID",
    ]);
    const foreignPoint = await call(a.cookies.operator, "post", "/credit-notes/drafts").send(
      draftBody(target.id, { emissionPointId: b.emissionPointId }),
    );
    expect([foreignPoint.status, bodyOf(foreignPoint).error.code]).toEqual([
      400,
      "EMISSION_POINT_NOT_FOUND",
    ]);
  });

  it("la anulación total no elige líneas y su vista previa es el total de la factura", async () => {
    const target = await invoice();
    const draft = await createDraft(target.id, {
      cause: "TOTAL_ANNULMENT",
      lines: [{ position: 1, physicalReturn: "4" }],
    });
    expect(draft.preview.issues).toEqual([]);
    expect(draft.lines).toEqual([{ position: 1, quantity: "10", physicalReturn: "4" }]);
    expect(draft.preview.lines.map((l) => [l.position, l.quantity, l.physicalReturn])).toEqual([
      [1, "10", "4"],
      [2, "1", "0"],
    ]);
    expect(draft.preview.totals?.total).toBe("130.00");
    const chosen = await call(a.cookies.operator, "post", "/credit-notes/drafts").send(
      draftBody(target.id, { cause: "TOTAL_ANNULMENT", lines: [{ position: 1, quantity: "3" }] }),
    );
    expect(chosen.status).toBe(400);
  });

  it("informa la integridad alterada de la factura como un problema que bloquea", async () => {
    const target = await invoice();
    await corruptArtifact(db.database.prisma, db.name, target.id, "SIGNED_XML");
    const draft = await createDraft(target.id);
    expect(draft.preview.issues.map((i) => i.code)).toEqual(["CREDIT_NOTE_INVOICE_INTEGRITY"]);
    expect(draft.preview.totals).toBeNull();
  });

  it("se recalcula con la capacidad vigente después de que otra nota se reserva", async () => {
    const target = await invoice();
    const draft = await createDraft(target.id, {
      lines: [{ position: 1, quantity: "2", physicalReturn: "0" }],
    });
    expect(draft.preview.lines[0]!.remainingQuantity).toBe("8");
    // Otra nota de la misma factura reserva 7 unidades.
    const other = await createDraft(target.id, {
      lines: [{ position: 1, quantity: "7", physicalReturn: "0" }],
    });
    const emitted = await call(a.cookies.operator, "post", "/credit-notes")
      .set("Idempotency-Key", `otra-${other.id}`)
      .send({ draftId: other.id, expectedVersion: other.version, declarations: DECLARATIONS });
    expect(emitted.status, JSON.stringify(emitted.body)).toBe(201);
    const reread = await call(a.cookies.operator, "get", `/credit-notes/drafts/${draft.id}`);
    expect(bodyOf(reread).data.preview.lines[0]!.remainingQuantity).toBe("1");
    const excess = await call(a.cookies.operator, "put", `/credit-notes/drafts/${draft.id}`).send({
      ...draftBody(target.id, { lines: [{ position: 1, quantity: "4", physicalReturn: "0" }] }),
      invoiceId: undefined,
      expectedVersion: draft.version,
    });
    expect(bodyOf(excess).data.preview.issues.map((i) => [i.code, i.line])).toEqual([
      ["CREDIT_NOTE_QUANTITY_EXCEEDED", 1],
    ]);
  });

  it("corrige con versión, lista los pendientes y elimina sin rastro fiscal", async () => {
    const target = await invoice();
    const draft = await createDraft(target.id);
    const { invoiceId: _ignored, ...content } = draftBody(target.id, { reason: "Corregido" });
    const updated = await call(a.cookies.operator, "put", `/credit-notes/drafts/${draft.id}`).send({
      ...content,
      expectedVersion: draft.version,
    });
    expect([updated.status, bodyOf(updated).data.version, bodyOf(updated).data.reason]).toEqual([
      200,
      2,
      "Corregido",
    ]);
    const stale = await call(a.cookies.operator, "put", `/credit-notes/drafts/${draft.id}`).send({
      ...content,
      expectedVersion: draft.version,
    });
    expect([stale.status, bodyOf(stale).error.code]).toEqual([409, "CREDIT_NOTE_DRAFT_CHANGED"]);
    const list = await call(a.cookies.operator, "get", "/credit-notes/drafts?pageSize=100");
    expect(bodyOf(list).data.map((d) => d.id)).toContain(draft.id);
    expect(bodyOf(list).data.find((d) => d.id === draft.id)).toMatchObject({
      invoice: { id: target.id },
      cause: "RETURN",
      previewTotal: "23.00",
    });
    const before = await fiscalTrace();
    expect(
      (await call(a.cookies.operator, "delete", `/credit-notes/drafts/${draft.id}`)).status,
    ).toBe(204);
    expect((await call(a.cookies.operator, "get", `/credit-notes/drafts/${draft.id}`)).status).toBe(
      404,
    );
    expect(await fiscalTrace()).toEqual(before);
  });

  it("las facturas elegibles excluyen las no autorizadas, las de consumidor final y las agotadas", async () => {
    const eligible = await invoice();
    const consumer = await invoice(a, { consumerFinal: true });
    const received = await invoice(a, { state: "RECEIVED" });
    const exhausted = await invoice();
    const annulment = await createDraft(exhausted.id, { cause: "TOTAL_ANNULMENT", lines: [] });
    const emitted = await call(a.cookies.operator, "post", "/credit-notes")
      .set("Idempotency-Key", `agotada-${annulment.id}`)
      .send({
        draftId: annulment.id,
        expectedVersion: annulment.version,
        declarations: DECLARATIONS,
      });
    expect(emitted.status, JSON.stringify(emitted.body)).toBe(201);

    const res = await call(
      a.cookies.operator,
      "get",
      "/credit-notes/eligible-invoices?pageSize=100",
    );
    const ids = bodyOf(res).data.map((i) => i.id);
    expect(ids).toContain(eligible.id);
    expect(ids).not.toContain(consumer.id);
    expect(ids).not.toContain(received.id);
    expect(ids).not.toContain(exhausted.id);
    expect(bodyOf(res).data.find((i) => i.id === eligible.id)).toMatchObject({
      documentNumber: eligible.documentNumber,
      total: "130.00",
      available: "130.00",
    });
    const search = await call(
      a.cookies.operator,
      "get",
      `/credit-notes/eligible-invoices?search=${eligible.documentNumber}`,
    );
    expect(bodyOf(search).data.map((i) => i.id)).toEqual([eligible.id]);
  });

  it("sin sesión responde 401 y la factura o el borrador de otra empresa, 404", async () => {
    const target = await invoice();
    expect((await request(api.app).get("/api/v1/credit-notes/drafts")).status).toBe(401);
    expect(
      (await request(api.app).post("/api/v1/credit-notes/drafts").send(draftBody(target.id)))
        .status,
    ).toBe(401);
    expect((await request(api.app).get("/api/v1/credit-notes/eligible-invoices")).status).toBe(401);
    const foreign = await call(b.cookies.admin, "post", "/credit-notes/drafts").send({
      ...draftBody(target.id),
      emissionPointId: b.emissionPointId,
    });
    expect([foreign.status, bodyOf(foreign).error.code]).toEqual([
      404,
      "CREDIT_NOTE_INVOICE_NOT_FOUND",
    ]);
    const draft = await createDraft(target.id);
    for (const method of ["get", "delete"] as const) {
      const res = await call(b.cookies.admin, method, `/credit-notes/drafts/${draft.id}`);
      expect([res.status, bodyOf(res).error.code]).toEqual([404, "CREDIT_NOTE_DRAFT_NOT_FOUND"]);
    }
    const others = await call(
      b.cookies.admin,
      "get",
      "/credit-notes/eligible-invoices?pageSize=100",
    );
    expect(bodyOf(others).data.map((i) => i.id)).not.toContain(target.id);
    // Un companyId en el cuerpo se rechaza.
    const withCompany = await call(a.cookies.operator, "post", "/credit-notes/drafts").send({
      ...draftBody(target.id),
      companyId: b.companyId,
    });
    expect(withCompany.status).toBe(400);
  });
  it("una factura de otro ambiente se informa en la vista previa y no se emite, sin reservar nada", async () => {
    // La empresa B emitió la factura en Pruebas y después pasó a Producción.
    const target = await invoice(b);
    const created = await call(b.cookies.operator, "post", "/credit-notes/drafts").send({
      ...draftBody(target.id),
      emissionPointId: b.emissionPointId,
      lines: [{ position: 2, quantity: "1" }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const current = await call(b.cookies.admin, "get", "/taxpayer");
    const changed = await call(b.cookies.admin, "put", "/taxpayer/environment").send({
      environment: "PRODUCTION",
      expectedVersion: (current.body as { data: { version: number } }).data.version,
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);

    const preview = await call(
      b.cookies.operator,
      "get",
      `/credit-notes/drafts/${bodyOf(created).data.id}`,
    );
    const issue = bodyOf(preview).data.preview.issues.find(
      (candidate) => candidate.code === "CREDIT_NOTE_INVOICE_NOT_ELIGIBLE",
    );
    expect(issue?.message).toContain("la nota de crédito debe ser del mismo ambiente");
    const before = await fiscalTrace();
    const emitted = await request(api.app)
      .post("/api/v1/credit-notes")
      .set("Cookie", b.cookies.operator)
      .set("Idempotency-Key", `otro-ambiente-${bodyOf(created).data.id}`)
      .send({
        draftId: bodyOf(created).data.id,
        expectedVersion: bodyOf(created).data.version,
        declarations: DECLARATIONS,
      });
    expect([emitted.status, bodyOf(emitted).error.code]).toEqual([
      409,
      "CREDIT_NOTE_INVOICE_NOT_ELIGIBLE",
    ]);
    expect(await fiscalTrace()).toEqual(before);
  });
});

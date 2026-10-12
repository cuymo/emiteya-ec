// API de borradores de nota de débito y facturas elegibles (add-debit-notes, tarea 5.2, design D4,
// D5, D6, D8 y D20): la factura en cada estado no autorizado y la de consumidor final se rechazan;
// otro ambiente y la integridad alterada se informan como problemas que bloquean; la vista previa
// ofrece solo los tratamientos de la factura y muestra las bases y los impuestos por tratamiento, el
// valor total y la forma de pago resuelta por el catálogo; los problemas van junto a su concepto;
// la versión del borrador se respeta; sin sesión `401` y otra empresa `404`. Un borrador no reserva
// número ni crea comprobantes.
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  DebitEligibleInvoiceView,
  DebitNoteDraftSummaryView,
  DebitNoteDraftView,
} from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { corruptArtifact } from "./archive-harness.ts";
import {
  IVA0,
  insertAuthorizedInvoice,
  insertCreditNote,
  type InvoiceCompany,
} from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

type Body = {
  data: DebitNoteDraftView & DebitNoteDraftSummaryView[] & DebitEligibleInvoiceView[];
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const CONCEPT = {
  cause: "LATE_PAYMENT_INTEREST",
  description: "Intereses por 30 días de mora",
  amount: "20.00",
  taxTreatment: "2:4",
};

describe("API de borradores de nota de débito", () => {
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
  const fiscalOf = (company: ReadyCompany) => ({
    companyId: company.companyId,
    adminId: company.adminId,
    points: [
      {
        establishmentId: company.establishmentId,
        emissionPointId: company.emissionPointId,
        code: "001",
      },
    ],
  });
  /** Factura de 10 × 10.00 al 15 % y 1 × 15.00 al 0 %, autorizada. */
  const invoice = (company = a, options: { consumerFinal?: boolean; state?: string } = {}) =>
    insertAuthorizedInvoice(
      db.database.prisma,
      companyOf(company),
      [
        { productId: good, quantity: "10", unitPrice: "10.00" },
        { productId: service, quantity: "1", unitPrice: "15.00", rate: IVA0 },
      ],
      options,
    );
  const draftBody = (invoiceId: string, overrides: Record<string, unknown> = {}) => ({
    invoiceId,
    emissionPointId: a.emissionPointId,
    paymentMethod: "20",
    concepts: [CONCEPT],
    ...overrides,
  });
  const createDraft = async (invoiceId: string, overrides: Record<string, unknown> = {}) => {
    const res = await call(a.cookies.operator, "post", "/debit-notes/drafts").send(
      draftBody(invoiceId, overrides),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const fiscalTrace = async () => ({
    notes: await db.database.prisma.electronicDocument.count({ where: { documentType: "05" } }),
    supports: await db.database.prisma.debitNoteSupport.count(),
    reservations: await db.database.prisma.fiscalSequenceReservation.count({
      where: { documentType: "05" },
    }),
  });

  beforeAll(async () => {
    db = await createMigratedSchema("debit_note_drafts_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "debito-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "debito-b", pool, p12Dir });
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
      const res = await call(a.cookies.operator, "post", "/debit-notes/drafts").send(
        draftBody(target.id),
      );
      expect([res.status, bodyOf(res).error.code], state).toEqual([
        409,
        "DEBIT_NOTE_INVOICE_NOT_ELIGIBLE",
      ]);
      expect(bodyOf(res).error.message, state).toBe(
        "Solo una factura autorizada admite nota de débito.",
      );
    }
  });

  it("una factura a consumidor final se rechaza por política del proyecto, sin reservar nada", async () => {
    const before = await fiscalTrace();
    const target = await invoice(a, { consumerFinal: true });
    const res = await call(a.cookies.operator, "post", "/debit-notes/drafts").send(
      draftBody(target.id),
    );
    expect([res.status, bodyOf(res).error.code]).toEqual([409, "DEBIT_NOTE_CONSUMER_FINAL"]);
    expect(bodyOf(res).error.message).toMatch(/política del sistema/);
    expect(bodyOf(res).error.message).not.toMatch(/NAC-DGERCGC25/);
    expect(await fiscalTrace()).toEqual(before);
  });

  it("la vista previa ofrece los tratamientos de la factura y calcula por tratamiento", async () => {
    const target = await invoice();
    const before = await fiscalTrace();
    const draft = await createDraft(target.id, {
      concepts: [
        CONCEPT,
        {
          cause: "POST_INVOICE_COST_EXPENSE",
          description: "Flete posterior a la venta",
          amount: "5.50",
          taxTreatment: "2:0",
        },
        { ...CONCEPT, description: "Interés del segundo mes", amount: "0.10" },
      ],
    });
    expect(draft.invoice).toMatchObject({
      id: target.id,
      documentNumber: target.documentNumber,
      total: "130.00",
    });
    expect(draft.paymentMethod).toBe("20");
    expect(draft.concepts.map((c) => [c.position, c.cause, c.amount, c.taxTreatment])).toEqual([
      [1, "LATE_PAYMENT_INTEREST", "20.00", "2:4"],
      [2, "POST_INVOICE_COST_EXPENSE", "5.50", "2:0"],
      [3, "LATE_PAYMENT_INTEREST", "0.10", "2:4"],
    ]);
    expect(draft.preview.issues).toEqual([]);
    expect(draft.preview.taxTreatments.map((t) => [t.key, t.percentage, t.label])).toEqual([
      ["2:0", "0", "IVA 0 %"],
      ["2:4", "15", "IVA 15 %"],
    ]);
    expect(draft.preview.totals).toEqual({
      withoutTaxes: "25.60",
      taxes: [
        {
          key: "2:0",
          taxCode: "2",
          rateCode: "0",
          percentage: "0",
          label: "IVA 0 %",
          base: "5.50",
          amount: "0.00",
        },
        {
          key: "2:4",
          taxCode: "2",
          rateCode: "4",
          percentage: "15",
          label: "IVA 15 %",
          base: "20.10",
          amount: "3.02",
        },
      ],
      total: "28.62",
    });
    expect(draft.preview.payment).toEqual({
      entryKey: "20",
      code: "20",
      label: "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO",
      amount: "28.62",
    });
    // Un borrador no reserva número ni crea comprobantes.
    expect(await fiscalTrace()).toEqual(before);
  });

  it("lista los problemas junto a su concepto, sin totales mientras no se calcula", async () => {
    const target = await invoice();
    const draft = await createDraft(target.id, {
      concepts: [
        CONCEPT,
        { cause: null, description: "Sin importe", amount: null, taxTreatment: "2:4" },
        { ...CONCEPT, taxTreatment: "2:2" },
      ],
    });
    expect(draft.preview.totals).toBeNull();
    expect(draft.preview.payment).toBeNull();
    expect(draft.preview.issues.map((i) => [i.code, i.concept])).toEqual([
      ["DEBIT_NOTE_DRAFT_INCOMPLETE", 2],
      ["DEBIT_NOTE_DRAFT_INCOMPLETE", 2],
      ["DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE", 3],
    ]);
    const empty = await createDraft(target.id, { concepts: [] });
    expect(empty.preview.issues.map((i) => i.code)).toEqual(["DEBIT_NOTE_CONCEPTS_REQUIRED"]);
  });

  it("la forma de pago se resuelve con el catálogo: obligatoria, existente y habilitada", async () => {
    const target = await invoice();
    const missing = await createDraft(target.id, { paymentMethod: null });
    expect(missing.preview.issues.map((i) => [i.code, i.message])).toEqual([
      ["DEBIT_NOTE_DRAFT_INCOMPLETE", "Elige la forma de pago de la nota de débito."],
    ]);
    expect(missing.preview.totals?.total).toBe("23.00");
    expect(missing.preview.payment).toBeNull();
    const unknown = await createDraft(target.id, { paymentMethod: "99" });
    expect(unknown.preview.issues.map((i) => i.code)).toEqual([
      "DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE",
    ]);
    await db.database.prisma.companyFiscalCatalogSetting.create({
      data: {
        companyId: a.companyId,
        catalogType: "payment-method",
        entryKey: "21",
        enabled: false,
        updatedBy: a.adminId,
      },
    });
    const disabled = await createDraft(target.id, { paymentMethod: "21" });
    expect(disabled.preview.issues.map((i) => i.code)).toEqual([
      "DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE",
    ]);
    // Una etiqueta, un importe o varias formas de pago se rechazan con un error de validación.
    for (const overrides of [
      { paymentMethod: "OTROS CON UTILIZACION" },
      { paymentMethod: ["01", "20"] },
      { payments: [{ paymentMethod: "20", amount: "23.00" }] },
    ]) {
      const res = await call(a.cookies.operator, "post", "/debit-notes/drafts").send(
        draftBody(target.id, overrides),
      );
      expect(res.status, JSON.stringify(overrides)).toBe(400);
    }
  });

  it("un punto de otra empresa se rechaza al guardar y un snapshot sin forma se informa sin fallar", async () => {
    const target = await invoice();
    const foreignPoint = await call(a.cookies.operator, "post", "/debit-notes/drafts").send(
      draftBody(target.id, { emissionPointId: b.emissionPointId }),
    );
    expect([foreignPoint.status, bodyOf(foreignPoint).error.code]).toEqual([
      400,
      "EMISSION_POINT_NOT_FOUND",
    ]);
    const production = await insertDocument(db.database.prisma, fiscalOf(a), "AUTHORIZED", {
      environment: "PRODUCTION",
      total: "115.00",
    });
    // Un documento sintético sin el snapshot de una factura: la vista previa informa su integridad
    // sin repararla ni fallar.
    const res = await call(a.cookies.operator, "post", "/debit-notes/drafts").send(
      draftBody(production.id),
    );
    expect(res.status).toBe(201);
    expect(bodyOf(res).data.preview.issues.map((i) => i.code)).toContain(
      "DEBIT_NOTE_INVOICE_INTEGRITY",
    );
  });

  it("informa la integridad alterada de la factura como un problema que bloquea", async () => {
    const target = await invoice();
    await corruptArtifact(db.database.prisma, db.name, target.id, "SIGNED_XML");
    const draft = await createDraft(target.id);
    expect(draft.preview.issues.map((i) => i.code)).toEqual(["DEBIT_NOTE_INVOICE_INTEGRITY"]);
    expect(draft.preview.totals).toBeNull();
  });

  it("corrige con versión, lista los pendientes y elimina sin rastro fiscal", async () => {
    const target = await invoice();
    const draft = await createDraft(target.id);
    const { invoiceId: _ignored, ...content } = draftBody(target.id, {
      concepts: [{ ...CONCEPT, amount: "40.00" }],
    });
    const updated = await call(a.cookies.operator, "put", `/debit-notes/drafts/${draft.id}`).send({
      ...content,
      expectedVersion: draft.version,
    });
    expect([
      updated.status,
      bodyOf(updated).data.version,
      bodyOf(updated).data.preview.totals?.total,
    ]).toEqual([200, 2, "46.00"]);
    const stale = await call(a.cookies.operator, "put", `/debit-notes/drafts/${draft.id}`).send({
      ...content,
      expectedVersion: draft.version,
    });
    expect([stale.status, bodyOf(stale).error.code]).toEqual([409, "DEBIT_NOTE_DRAFT_CHANGED"]);
    const list = await call(a.cookies.operator, "get", "/debit-notes/drafts?pageSize=100");
    expect(bodyOf(list).data.find((d) => d.id === draft.id)).toMatchObject({
      invoice: { id: target.id },
      conceptCount: 1,
      previewTotal: "46.00",
    });
    const before = await fiscalTrace();
    expect(
      (await call(a.cookies.operator, "delete", `/debit-notes/drafts/${draft.id}`)).status,
    ).toBe(204);
    expect((await call(a.cookies.operator, "get", `/debit-notes/drafts/${draft.id}`)).status).toBe(
      404,
    );
    expect(await fiscalTrace()).toEqual(before);
  });

  it("las facturas elegibles excluyen las no autorizadas, las de consumidor final y las notas", async () => {
    const eligible = await invoice();
    const consumer = await invoice(a, { consumerFinal: true });
    const received = await invoice(a, { state: "RECEIVED" });
    const creditNote = await insertCreditNote(db.database.prisma, fiscalOf(a), eligible, {
      lines: [{ position: 1, quantity: "1" }],
    });
    const res = await call(
      a.cookies.operator,
      "get",
      "/debit-notes/eligible-invoices?pageSize=100",
    );
    const ids = bodyOf(res).data.map((i) => i.id);
    expect(ids).toContain(eligible.id);
    expect(ids).not.toContain(consumer.id);
    expect(ids).not.toContain(received.id);
    expect(ids).not.toContain(creditNote.id);
    expect(bodyOf(res).data.find((i) => i.id === eligible.id)).toEqual({
      id: eligible.id,
      documentNumber: eligible.documentNumber,
      issueDate: "2026-10-01",
      buyerIdentification: "0992877878001",
      buyerName: "EL PERNO CIA. LTDA.",
      total: "130.00",
    });
    const search = await call(
      a.cookies.operator,
      "get",
      `/debit-notes/eligible-invoices?search=${eligible.documentNumber}`,
    );
    expect(bodyOf(search).data.map((i) => i.id)).toEqual([eligible.id]);
    // Una nota de crédito tampoco es una factura para un borrador.
    const fromNote = await call(a.cookies.operator, "post", "/debit-notes/drafts").send(
      draftBody(creditNote.id),
    );
    expect([fromNote.status, bodyOf(fromNote).error.code]).toEqual([
      404,
      "DEBIT_NOTE_INVOICE_NOT_FOUND",
    ]);
  });

  it("sin sesión responde 401 y la factura o el borrador de otra empresa, 404", async () => {
    const target = await invoice();
    expect((await request(api.app).get("/api/v1/debit-notes/drafts")).status).toBe(401);
    expect(
      (await request(api.app).post("/api/v1/debit-notes/drafts").send(draftBody(target.id))).status,
    ).toBe(401);
    expect((await request(api.app).get("/api/v1/debit-notes/eligible-invoices")).status).toBe(401);
    const foreign = await call(b.cookies.admin, "post", "/debit-notes/drafts").send({
      ...draftBody(target.id),
      emissionPointId: b.emissionPointId,
    });
    expect([foreign.status, bodyOf(foreign).error.code]).toEqual([
      404,
      "DEBIT_NOTE_INVOICE_NOT_FOUND",
    ]);
    const draft = await createDraft(target.id);
    for (const method of ["get", "delete"] as const) {
      const res = await call(b.cookies.admin, method, `/debit-notes/drafts/${draft.id}`);
      expect([res.status, bodyOf(res).error.code]).toEqual([404, "DEBIT_NOTE_DRAFT_NOT_FOUND"]);
    }
    const others = await call(
      b.cookies.admin,
      "get",
      "/debit-notes/eligible-invoices?pageSize=100",
    );
    expect(bodyOf(others).data.map((i) => i.id)).not.toContain(target.id);
    // Un companyId en el cuerpo se rechaza.
    const withCompany = await call(a.cookies.operator, "post", "/debit-notes/drafts").send({
      ...draftBody(target.id),
      companyId: b.companyId,
    });
    expect(withCompany.status).toBe(400);
  });

  it("una factura de otro ambiente se informa en la vista previa y desaparece de las elegibles", async () => {
    // La empresa B emitió la factura en Pruebas y después pasó a Producción.
    const target = await invoice(b);
    const created = await call(b.cookies.operator, "post", "/debit-notes/drafts").send({
      ...draftBody(target.id),
      emissionPointId: b.emissionPointId,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const listed = await call(
      b.cookies.operator,
      "get",
      "/debit-notes/eligible-invoices?pageSize=100",
    );
    expect(bodyOf(listed).data.map((i) => i.id)).toContain(target.id);
    const current = await call(b.cookies.admin, "get", "/taxpayer");
    const changed = await call(b.cookies.admin, "put", "/taxpayer/environment").send({
      environment: "PRODUCTION",
      expectedVersion: (current.body as { data: { version: number } }).data.version,
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const preview = await call(
      b.cookies.operator,
      "get",
      `/debit-notes/drafts/${bodyOf(created).data.id}`,
    );
    const issue = bodyOf(preview).data.preview.issues.find(
      (candidate) => candidate.code === "DEBIT_NOTE_INVOICE_NOT_ELIGIBLE",
    );
    expect(issue?.message).toContain("la nota de débito debe ser del mismo ambiente");
    const after = await call(
      b.cookies.operator,
      "get",
      "/debit-notes/eligible-invoices?pageSize=100",
    );
    expect(bodyOf(after).data.map((i) => i.id)).not.toContain(target.id);
  });
});

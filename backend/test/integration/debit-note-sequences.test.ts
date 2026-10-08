// Secuenciales independientes por tipo en el mismo ámbito de numeración (add-debit-notes,
// add-withholding-receipts, add-shipping-guides y add-purchase-settlements, spec document-emission
// "Secuenciales independientes"; ADR 0003): en un mismo ambiente, establecimiento y punto, factura →
// nota de crédito → nota de débito → retención → guía de remisión → liquidación de compra → factura,
// y después guía → liquidación → retención → nota de débito → nota de crédito → factura. Cada tipo
// (01, 03, 04, 05, 06 y 07) sigue su propio contador, sin huecos, y ninguno consume ni salta el de
// otro; el número, la columna, la clave de acceso y el XML firmado dicen lo mismo. La primera factura
// es autorizada por el arnés con la reserva real del secuencial (las notas y la guía exigen una
// factura autorizada y la transmisión está apagada); las demás se emiten por HTTP.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { insertAuthorizedInvoice } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Emitted = { id: string; documentNumber: string; accessKey: string; state: string };
const dataOf = (res: { body: unknown }) =>
  (res.body as { data: Emitted & { version: number } }).data;
const CREDIT_DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};
const PURCHASE_DECLARATIONS = {
  policyVersion: 1,
  statements: [
    "NATURAL_PERSON_NOT_REQUIRED_TO_KEEP_ACCOUNTING",
    "NO_RUC_OR_SUSPENDED_RUC",
    "UNABLE_TO_ISSUE_DUE_TO_CULTURAL_LEVEL_OR_RUSTICITY",
    "MOVABLE_GOODS_OR_SERVICES_TRANSACTION",
  ],
};
const DEBIT_DECLARATIONS = {
  version: 1,
  statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"],
};

describe("secuenciales independientes de la factura, la liquidación, las notas, la retención y la guía", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let ruralSupplierId: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const post = async (path: string, body: unknown, key?: string) => {
    const req = request(api.app).post(`/api/v1${path}`).set("Cookie", a.cookies.operator);
    const res = await (key ? req.set("Idempotency-Key", key) : req).send(body as object);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return dataOf(res);
  };
  const emitInvoice = async () => {
    const draft = await post("/invoices/drafts", {
      emissionPointId: a.emissionPointId,
      buyerPartyId: a.customerId,
      lines: [{ productId: a.productId, quantity: "1", discount: "0" }],
      payments: [{ paymentMethod: "01" }],
    });
    return post("/invoices", { draftId: draft.id, expectedVersion: draft.version }, randomUUID());
  };
  const emitCreditNote = async (invoiceId: string) => {
    const draft = await post("/credit-notes/drafts", {
      invoiceId,
      emissionPointId: a.emissionPointId,
      cause: "RETURN",
      reason: "Devolución de un saco",
      lines: [{ position: 1, quantity: "1" }],
    });
    return post(
      "/credit-notes",
      { draftId: draft.id, expectedVersion: draft.version, declarations: CREDIT_DECLARATIONS },
      randomUUID(),
    );
  };
  const emitWithholding = async () => {
    const draft = await post("/withholding-receipts/drafts", {
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
    return post(
      "/withholding-receipts",
      { draftId: draft.id, expectedVersion: draft.version },
      randomUUID(),
    );
  };
  const emitDebitNote = async (invoiceId: string) => {
    const draft = await post("/debit-notes/drafts", {
      invoiceId,
      emissionPointId: a.emissionPointId,
      paymentMethod: "20",
      concepts: [
        {
          cause: "LATE_PAYMENT_INTEREST",
          description: "Intereses de mora",
          amount: "3.10",
          taxTreatment: "2:4",
        },
      ],
    });
    return post(
      "/debit-notes",
      { draftId: draft.id, expectedVersion: draft.version, declarations: DEBIT_DECLARATIONS },
      randomUUID(),
    );
  };

  const emitShippingGuide = async (invoiceId: string) => {
    const draft = await post("/shipping-guides/drafts", {
      emissionPointId: a.emissionPointId,
      transporter: { source: "SELF" },
      plate: "PAA-1234",
      transportStart: "2026-10-06",
      transportEnd: "2026-10-06",
      recipients: [
        {
          recipient: { kind: "PARTY", partyId: a.customerId },
          address: "Av. Quito y Guayaquil",
          motive: "Venta",
          support: { kind: "INTERNAL_INVOICE", invoiceId },
          details: [{ productId: a.productId, description: "Cemento 50 kg", quantity: "10" }],
        },
      ],
    });
    return post(
      "/shipping-guides",
      { draftId: draft.id, expectedVersion: draft.version, exceptionDeclaration: null },
      randomUUID(),
    );
  };

  const emitPurchaseSettlement = async () => {
    const draft = await post("/purchase-settlements/drafts", {
      emissionPointId: a.emissionPointId,
      supplierPartyId: ruralSupplierId,
      lines: [{ description: "Cacao en grano", quantity: "10", unitPrice: "4.50", ivaRate: "0" }],
      payments: [{ paymentMethod: "01", total: "45.00", term: "0", timeUnit: "días" }],
    });
    return post(
      "/purchase-settlements",
      { draftId: draft.id, expectedVersion: draft.version, declarations: PURCHASE_DECLARATIONS },
      randomUUID(),
    );
  };

  /** Tipo y secuencial según el número, la columna, la clave de acceso y el XML firmado. */
  const numbering = async (document: { id: string }) => {
    const stored = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: document.id },
    });
    const signed = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: document.id, kind: "SIGNED_XML" },
    });
    const xml = Buffer.from(signed.content).toString("utf8");
    return {
      type: stored.documentType,
      number: stored.documentNumber,
      sequential: stored.sequential,
      keyType: stored.accessKey.slice(8, 10),
      keySeries: stored.accessKey.slice(24, 30),
      keySequential: stored.accessKey.slice(30, 39),
      xmlType: /<codDoc>(\d+)<\/codDoc>/.exec(xml)?.[1],
      xmlSequential: /<secuencial>(\d+)<\/secuencial>/.exec(xml)?.[1],
    };
  };
  const expected = (type: string, sequential: number) => {
    const padded = String(sequential).padStart(9, "0");
    return {
      type,
      number: `001-001-${padded}`,
      sequential,
      keyType: type,
      keySeries: "001001",
      keySequential: padded,
      xmlType: type,
      xmlSequential: padded,
    };
  };

  beforeAll(async () => {
    db = await createMigratedSchema("debit_note_sequences");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    // 10:00 del 6 de octubre de 2026 en Ecuador: la retención resuelve el bloque vigente del ATS.
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-06T15:00:00Z"),
    });
    a = await readyCompany(api, db, {
      slug: "secuenciales-nd",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    ruralSupplierId = await insertPurchaseSupplier(db.database.prisma, a);
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("factura, nota de crédito, nota de débito, retención, guía, liquidación y factura siguen cada una su propio contador", async () => {
    // Factura 1, autorizada con la reserva real del secuencial de facturas.
    const firstInvoice = await insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [{ productId: a.productId, quantity: "10", unitPrice: "10.00" }],
    );
    const firstCredit = await emitCreditNote(firstInvoice.id);
    const firstDebit = await emitDebitNote(firstInvoice.id);
    const firstWithholding = await emitWithholding();
    const firstGuide = await emitShippingGuide(firstInvoice.id);
    const firstSettlement = await emitPurchaseSettlement();
    const secondInvoice = await emitInvoice();
    // Segunda ronda en otro orden: la guía y la liquidación primero.
    const secondGuide = await emitShippingGuide(firstInvoice.id);
    const secondSettlement = await emitPurchaseSettlement();
    const secondWithholding = await emitWithholding();
    const secondDebit = await emitDebitNote(firstInvoice.id);
    const secondCredit = await emitCreditNote(firstInvoice.id);
    const thirdInvoice = await emitInvoice();

    const stored = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: firstInvoice.id },
    });
    expect({
      type: stored.documentType,
      number: stored.documentNumber,
      sequential: stored.sequential,
      keyType: stored.accessKey.slice(8, 10),
      keySeries: stored.accessKey.slice(24, 30),
      keySequential: stored.accessKey.slice(30, 39),
    }).toEqual({
      type: "01",
      number: "001-001-000000001",
      sequential: 1,
      keyType: "01",
      keySeries: "001001",
      keySequential: "000000001",
    });
    for (const [document, type, sequential] of [
      [firstCredit, "04", 1],
      [firstDebit, "05", 1],
      [firstWithholding, "07", 1],
      [firstGuide, "06", 1],
      [firstSettlement, "03", 1],
      [secondInvoice, "01", 2],
      [secondGuide, "06", 2],
      [secondSettlement, "03", 2],
      [secondWithholding, "07", 2],
      [secondDebit, "05", 2],
      [secondCredit, "04", 2],
      [thirdInvoice, "01", 3],
    ] as const) {
      expect(document.state).toBe("SIGNED");
      expect(await numbering(document)).toEqual(expected(type, sequential));
    }

    // En el ámbito del punto, cada tipo tiene su contador y sus reservas, sin huecos ni cruces.
    const scope = {
      companyId: a.companyId,
      environment: "TEST" as const,
      establishmentId: a.establishmentId,
      emissionPointId: a.emissionPointId,
    };
    const counters = await db.database.prisma.fiscalSequence.findMany({
      where: scope,
      orderBy: { documentType: "asc" },
    });
    expect(counters.map((c) => [c.documentType, c.nextNumber])).toEqual([
      ["01", 4],
      ["03", 3],
      ["04", 3],
      ["05", 3],
      ["06", 3],
      ["07", 3],
    ]);
    const reservations = await db.database.prisma.fiscalSequenceReservation.findMany({
      where: scope,
      orderBy: [{ documentType: "asc" }, { sequential: "asc" }],
    });
    expect(reservations.map((r) => [r.documentType, r.sequential])).toEqual([
      ["01", 1],
      ["01", 2],
      ["01", 3],
      ["03", 1],
      ["03", 2],
      ["04", 1],
      ["04", 2],
      ["05", 1],
      ["05", 2],
      ["06", 1],
      ["06", 2],
      ["07", 1],
      ["07", 2],
    ]);
    // Las claves de acceso son todas distintas.
    const keys = await db.database.prisma.electronicDocument.findMany({
      where: { companyId: a.companyId },
      select: { accessKey: true },
    });
    expect(new Set(keys.map((k) => k.accessKey)).size).toBe(keys.length);
  });
});

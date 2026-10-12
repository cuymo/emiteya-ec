// Independencia de la guía de remisión con PostgreSQL real (add-shipping-guides, tarea 9.1, design
// D1 y D2): una guía autorizada, devuelta o no autorizada de un producto con control de stock no
// registra movimientos ni cambia saldos de inventario, no cambia la factura sustento ni su capacidad
// acreditable o devolvible, y no asigna roles a sus terceros (el destinatario sin roles sigue sin
// ellos y el transportista conserva los suyos). Las reconciliaciones diagnósticas no informan
// diferencias. Respuestas del SRI sintéticas, sin red.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { reconcileCreditCapacity } from "../../src/modules/credit-notes/infrastructure/index.ts";
import {
  reconcileStock,
  reconcileStockReturnCapacity,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { receptionResponse, response } from "../support/sri-responses.ts";
import {
  IVA0,
  insertAuthorizedInvoice,
  recordOutflow,
  type AuthorizedInvoiceDocument,
} from "./credit-notes-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { buildArchiveApp } from "./archive-api-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { insertGuideParty } from "./shipping-guide-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: TestDocument & { version: number } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("la guía no toca el inventario, la factura sustento, las capacidades ni los roles", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let good: string;
  let carrierId: string;
  let recipientId: string;
  let sri: CreditNoteTransmission;
  let invoice: AuthorizedInvoiceDocument;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const post = async (path: string, body: object, key?: string) => {
    const req = request(api.app).post(`/api/v1${path}`).set("Cookie", a.cookies.operator);
    const res = await (key ? req.set("Idempotency-Key", key) : req).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  /**
   * Guía firmada del producto con stock: la factura sustento a su comprador y una consignación a un
   * tercero sin roles, con un transportista tercero.
   */
  const guide = async () => {
    const draft = await post("/shipping-guides/drafts", {
      emissionPointId: a.emissionPointId,
      transporter: { source: "PARTY", partyId: carrierId },
      plate: "PAA-1234",
      transportStart: "2026-10-06",
      transportEnd: "2026-10-06",
      recipients: [
        {
          recipient: { kind: "PARTY", partyId: a.customerId },
          address: "Av. Quito y Guayaquil",
          motive: "Venta",
          support: { kind: "INTERNAL_INVOICE", invoiceId: invoice.id },
          details: [{ productId: good, description: "Producto con stock", quantity: "10" }],
        },
        {
          recipient: { kind: "PARTY", partyId: recipientId },
          address: "Calle Sucre 12",
          motive: "Consignación",
          support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
          details: [{ productId: good, description: "Producto con stock", quantity: "5" }],
        },
      ],
    });
    return post(
      "/shipping-guides",
      {
        draftId: draft.id,
        expectedVersion: draft.version,
        exceptionDeclaration: { policyVersion: 1 },
      },
      randomUUID(),
    );
  };
  /** Transmite la guía firmada: recibida y, después, autorizada o no autorizada. */
  const conclude = async (doc: TestDocument, outcome: "AUTHORIZED" | "NOT_AUTHORIZED") => {
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.leasePending(doc.id, "sri.transmit"), sri.context());
    sri.reply(doc, [
      outcome === "AUTHORIZED"
        ? sri.authorized(doc)
        : sri.authorized(doc, { estado: "NO AUTORIZADO", comprobante: undefined }),
    ]);
    await sri.authorize().run(await sri.leasePending(doc.id, "sri.authorize"), sri.context());
  };
  const stateOf = async (id: string) =>
    (await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  /** Inventario, capacidades, comprobantes que no son guías y roles, tal como están en la base. */
  const ledger = async () => {
    const prisma = db.database.prisma;
    const companyId = a.companyId;
    return {
      movements: await prisma.stockMovement.findMany({
        where: { companyId },
        orderBy: { id: "asc" },
      }),
      balances: await prisma.stockBalance.findMany({
        where: { companyId },
        orderBy: { productId: "asc" },
      }),
      creditCapacities: await prisma.creditCapacity.findMany({ orderBy: { invoiceId: "asc" } }),
      creditCapacityLines: await prisma.creditCapacityLine.findMany({
        orderBy: [{ invoiceId: "asc" }, { position: "asc" }],
      }),
      creditReservations: await prisma.creditReservation.count(),
      returnCapacities: await prisma.stockReturnCapacity.findMany({
        orderBy: [{ invoiceId: "asc" }, { productId: "asc" }],
      }),
      returnReservations: await prisma.stockReturnReservation.count(),
      documents: await prisma.electronicDocument.findMany({
        where: { companyId, documentType: { not: "06" } },
        orderBy: { id: "asc" },
      }),
      transitions: await prisma.documentStateTransition.count({
        where: { document: { documentType: { not: "06" } } },
      }),
      artifacts: await prisma.documentArtifact.count({
        where: { document: { documentType: { not: "06" } } },
      }),
      roles: await prisma.party.findMany({
        where: { companyId },
        select: { id: true, roles: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    };
  };

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guide_independence");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-06T15:00:00Z"),
    });
    a = await readyCompany(api, db, {
      slug: "independencia-guia",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    const prisma = db.database.prisma;
    const company = { companyId: a.companyId, adminId: a.adminId, points: [] };
    good = await insertProduct(prisma, company, { name: "Producto con stock" });
    carrierId = await insertGuideParty(prisma, company, "1791111111001", {
      roles: ["CARRIER", "SUPPLIER"],
      legalName: "TRANSPORTES ANDINOS S.A.",
    });
    recipientId = await insertGuideParty(prisma, company, "1793333333001", {
      legalName: "DESTINATARIO SIN ROL S.A.",
    });
    sri = creditNoteTransmission(prisma, createPrismaJobStore(prisma, db.name));
    // Factura de 100.00 con inventario y su salida registrada.
    invoice = await insertAuthorizedInvoice(
      prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [
        {
          productId: good,
          quantity: "10",
          unitPrice: "10.00",
          rate: IVA0,
          inventoryAffectsStock: true,
        },
      ],
    );
    await recordOutflow(prisma, a, invoice, good, "10");
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("autorizada, devuelta o no autorizada, una guía no cambia nada fuera de ella", async () => {
    const before = await ledger();
    expect(before.movements.length).toBeGreaterThan(0);
    expect(before.balances.length).toBeGreaterThan(0);

    const authorized = await guide();
    await conclude(authorized, "AUTHORIZED");
    const rejected = await guide();
    await conclude(rejected, "NOT_AUTHORIZED");
    const returned = await guide();
    sri.replies.push(
      response(
        receptionResponse("DEVUELTA", [
          {
            accessKey: returned.accessKey,
            messages: [{ identifier: "82", message: "mensaje sintético", type: "ERROR" }],
          },
        ]),
      ),
    );
    await sri.transmit().run(await sri.leasePending(returned.id, "sri.transmit"), sri.context());
    expect([
      await stateOf(authorized.id),
      await stateOf(rejected.id),
      await stateOf(returned.id),
    ]).toEqual(["AUTHORIZED", "NOT_AUTHORIZED", "RETURNED"]);

    // El inventario, las capacidades, la factura, los demás comprobantes y los roles no cambian.
    expect(await ledger()).toEqual(before);
    const prisma = db.database.prisma;
    const ids = [authorized.id, rejected.id, returned.id];
    expect(await prisma.stockMovement.count({ where: { documentId: { in: ids } } })).toBe(0);
    expect(await prisma.creditCapacity.count({ where: { invoiceId: { in: ids } } })).toBe(0);
    const roles = await prisma.party.findMany({
      where: { id: { in: [carrierId, recipientId] } },
      select: { id: true, roles: true },
    });
    expect(Object.fromEntries(roles.map((party) => [party.id, party.roles]))).toEqual({
      [carrierId]: ["CARRIER", "SUPPLIER"],
      [recipientId]: [],
    });
    expect(await reconcileCreditCapacity(prisma, a.companyId)).toEqual([]);
    expect(await reconcileStock(prisma, a.companyId)).toEqual([]);
    expect(await reconcileStockReturnCapacity(prisma, a.companyId)).toEqual([]);
  });

  it("la factura sigue con todo su crédito y la guía no es un documento sustento de las notas", async () => {
    const credit = await request(api.app)
      .get(`/api/v1/credit-notes/invoices/${invoice.id}/credit`)
      .set("Cookie", a.cookies.operator);
    expect(credit.status).toBe(200);
    expect(credit.body).toMatchObject({
      data: { total: "100.00", applied: "0.00", reserved: "0.00", available: "100.00" },
    });
    const emitted = await guide();
    for (const path of ["/credit-notes/eligible-invoices", "/debit-notes/eligible-invoices"]) {
      const eligible = await request(api.app)
        .get(`/api/v1${path}?pageSize=100`)
        .set("Cookie", a.cookies.operator);
      expect(eligible.status).toBe(200);
      expect((eligible.body as { data: { id: string }[] }).data.map((i) => i.id)).not.toContain(
        emitted.id,
      );
    }
  });

  it("la bandeja filtra las guías y las encuentra por la identificación de su segundo destinatario", async () => {
    const archive = buildArchiveApp(db);
    const filtered = await request(archive.app)
      .get("/api/v1/documents?documentType=06&pageSize=100")
      .set("Cookie", a.cookies.operator);
    const rows = (
      filtered.body as {
        data: {
          documentType: string;
          buyer: unknown;
          total: unknown;
          recipients: { count: number; name: string | null };
        }[];
      }
    ).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (row) =>
          row.documentType === "06" &&
          row.buyer === null &&
          row.total === null &&
          row.recipients.count === 2 &&
          row.recipients.name === null,
      ),
    ).toBe(true);
    const bySecond = await request(archive.app)
      .get("/api/v1/documents?identification=1793333333001&pageSize=100")
      .set("Cookie", a.cookies.operator);
    const found = (bySecond.body as { data: { documentType: string }[] }).data;
    expect(found.length).toBe(rows.length);
    expect(found.every((row) => row.documentType === "06")).toBe(true);
  });
});

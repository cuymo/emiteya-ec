// Independencia de la liquidación de compra con PostgreSQL real (add-purchase-settlements, tarea 9.1,
// design D1, D2 y D10; BR-95): una liquidación autorizada, devuelta o no autorizada con una línea de un
// producto bien con control de stock no reserva, aumenta ni ajusta stock ni crea movimientos; no crea
// compras, cuentas por pagar, facturas recibidas ni comprobantes de retención; no cambia las facturas,
// las capacidades, el producto ni los roles del proveedor. Las reconciliaciones diagnósticas del
// inventario y de las capacidades no informan diferencias. Respuestas del SRI sintéticas, sin red.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PURCHASE_SETTLEMENT_STATEMENTS } from "@facturador/contracts";
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
import { IVA0, insertAuthorizedInvoice, recordOutflow } from "./credit-notes-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: TestDocument & { version: number } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("la liquidación no toca el inventario, las compras, las retenciones ni los demás registros", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let good: string;
  let supplierId: string;
  let sri: CreditNoteTransmission;
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
  /** Liquidación firmada con una línea del producto bien con control de stock y otra libre. */
  const settlement = async () => {
    const draft = await post("/purchase-settlements/drafts", {
      emissionPointId: a.emissionPointId,
      supplierPartyId: supplierId,
      lines: [
        {
          productId: good,
          description: "Producto con stock",
          quantity: "25",
          unitPrice: "2.00",
          ivaRate: "0",
        },
        { description: "Flete en acémila", quantity: "1", unitPrice: "5.00", ivaRate: "0" },
      ],
      payments: [{ paymentMethod: "01", total: "55.00", term: "0", timeUnit: "días" }],
    });
    return post(
      "/purchase-settlements",
      {
        draftId: draft.id,
        expectedVersion: draft.version,
        declarations: { policyVersion: 1, statements: [...PURCHASE_SETTLEMENT_STATEMENTS] },
      },
      randomUUID(),
    );
  };
  /** Transmite la liquidación firmada: recibida y, después, autorizada o no autorizada. */
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
  /** Inventario, capacidades, comprobantes que no son liquidaciones, el producto y los roles. */
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
      creditReservations: await prisma.creditReservation.count(),
      returnCapacities: await prisma.stockReturnCapacity.findMany({
        orderBy: [{ invoiceId: "asc" }, { productId: "asc" }],
      }),
      returnReservations: await prisma.stockReturnReservation.count(),
      withholdings: await prisma.withholdingReceipt.count(),
      withholdingDrafts: await prisma.withholdingReceiptDraft.count(),
      documents: await prisma.electronicDocument.findMany({
        where: { companyId, documentType: { not: "03" } },
        orderBy: { id: "asc" },
      }),
      products: await prisma.product.findMany({ where: { companyId }, orderBy: { id: "asc" } }),
      parties: await prisma.party.findMany({
        where: { companyId },
        select: { id: true, roles: true, legalName: true, updatedAt: true },
        orderBy: { id: "asc" },
      }),
    };
  };

  beforeAll(async () => {
    db = await createMigratedSchema("purchase_settlement_independence");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-07T15:00:00Z"),
    });
    a = await readyCompany(api, db, {
      slug: "independencia-liquidacion",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    const prisma = db.database.prisma;
    const company = { companyId: a.companyId, adminId: a.adminId, points: [] };
    good = await insertProduct(prisma, company, { name: "Producto con stock" });
    supplierId = await insertPurchaseSupplier(prisma, a);
    sri = creditNoteTransmission(prisma, createPrismaJobStore(prisma, db.name));
    // Una factura con inventario y su salida registrada: el producto tiene saldo y movimientos.
    const invoice = await insertAuthorizedInvoice(
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

  it("autorizada, devuelta o no autorizada, una liquidación no cambia nada fuera de ella", async () => {
    const before = await ledger();
    expect(before.movements.length).toBeGreaterThan(0);
    expect(before.balances.length).toBeGreaterThan(0);

    const authorized = await settlement();
    await conclude(authorized, "AUTHORIZED");
    const rejected = await settlement();
    await conclude(rejected, "NOT_AUTHORIZED");
    const returned = await settlement();
    sri.replies.push(
      response(
        receptionResponse("DEVUELTA", [
          {
            accessKey: returned.accessKey,
            messages: [{ identifier: "35", message: "mensaje sintético", type: "ERROR" }],
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

    // El inventario, las capacidades, las retenciones, los demás comprobantes, el producto y los
    // roles no cambian.
    expect(await ledger()).toEqual(before);
    const prisma = db.database.prisma;
    const ids = [authorized.id, rejected.id, returned.id];
    expect(await prisma.stockMovement.count({ where: { documentId: { in: ids } } })).toBe(0);
    expect(await reconcileCreditCapacity(prisma, a.companyId)).toEqual([]);
    expect(await reconcileStock(prisma, a.companyId)).toEqual([]);
    expect(await reconcileStockReturnCapacity(prisma, a.companyId)).toEqual([]);
    // El sistema no tiene compras, cuentas por pagar ni facturas recibidas: ninguna tabla nueva las
    // representa, y la liquidación solo tiene su borrador, su registro y sus declaraciones.
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = ${db.name} AND table_name ~ '(purchase|payable|received|supplier_invoice)'`;
    expect(tables.map((row) => row.table_name).sort()).toEqual([
      "purchase_settlement",
      "purchase_settlement_declaration",
      "purchase_settlement_draft",
    ]);
  });
});

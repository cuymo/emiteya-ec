// Concurrencia de la reserva de una guía de remisión con PostgreSQL real (add-shipping-guides, tarea
// 7.3, design D13 y D15): dos guías simultáneas sobre la misma factura son válidas y reciben
// secuenciales distintos, porque una factura no tiene capacidad que consumir; dos emisiones
// simultáneas del mismo borrador con claves distintas dejan una sola guía y la otra responde 409.
// Se repite varias rondas para descartar fallos intermitentes.
import { randomUUID } from "node:crypto";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ShippingGuideView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { insertAuthorizedInvoice } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: ShippingGuideView & { id: string; version: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const ROUNDS = 4;

describe("concurrencia de la reserva de una guía de remisión", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let invoiceId: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const draft = async (quantity = "10") => {
    const res = await request(api.app)
      .post("/api/v1/shipping-guides/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
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
            details: [{ productId: a.productId, description: "Cemento 50 kg", quantity }],
          },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (created: { id: string; version: number }, key = randomUUID()) =>
    request(api.app)
      .post("/api/v1/shipping-guides")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", key)
      .send({ draftId: created.id, expectedVersion: created.version, exceptionDeclaration: null });

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guide_concurrency");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-06T15:00:00Z"),
    });
    a = await readyCompany(api, db, {
      slug: "concurrencia-guia",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    invoiceId = (
      await insertAuthorizedInvoice(
        db.database.prisma,
        {
          companyId: a.companyId,
          adminId: a.adminId,
          establishmentId: a.establishmentId,
          emissionPointId: a.emissionPointId,
        },
        [{ productId: a.productId, quantity: "10", unitPrice: "8.75" }],
      )
    ).id;
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("dos guías simultáneas sobre la misma factura son válidas y tienen secuenciales distintos", async () => {
    const invoiceBefore = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    for (let round = 0; round < ROUNDS; round++) {
      const [first, second] = await Promise.all([draft(), draft("5")]);
      const [one, two] = await Promise.all([emit(first), emit(second)]);
      expect([one.status, two.status], JSON.stringify([one.body, two.body])).toEqual([201, 201]);
      expect(bodyOf(one).data.documentNumber).not.toBe(bodyOf(two).data.documentNumber);
      for (const res of [one, two]) {
        const { support } = bodyOf(res).data.recipients[0]!;
        expect(support.kind === "INTERNAL_INVOICE" && support.invoice.id).toBe(invoiceId);
      }
      // La cantidad reducida antes de emitir es la de la guía.
      expect(bodyOf(two).data.recipients[0]!.details[0]!.quantity).toBe("5");
    }
    // La factura no cambia: ni su estado, ni su total, ni su snapshot.
    const invoiceAfter = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    expect([invoiceAfter.state, invoiceAfter.total?.toFixed(), invoiceAfter.snapshot]).toEqual([
      invoiceBefore.state,
      invoiceBefore.total?.toFixed(),
      invoiceBefore.snapshot,
    ]);
    // Los secuenciales de las guías no tienen huecos ni repetidos.
    const numbers = (
      await db.database.prisma.electronicDocument.findMany({
        where: { companyId: a.companyId, documentType: "06" },
        select: { sequential: true },
      })
    )
      .map((document) => document.sequential)
      .sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, index) => index + 1));
    expect(
      await db.database.prisma.shippingGuide.count({ where: { companyId: a.companyId } }),
    ).toBe(numbers.length);
  });

  it("dos emisiones simultáneas del mismo borrador con claves distintas dejan una sola guía", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const created = await draft();
      const before = await db.database.prisma.electronicDocument.count({
        where: { documentType: "06" },
      });
      const results = await Promise.all([emit(created), emit(created)]);
      const statuses = results.map((res) => res.status).sort();
      expect(statuses, JSON.stringify(results.map((res) => res.body as unknown))).toEqual([
        201, 409,
      ]);
      const conflict = results.find((res) => res.status === 409)!;
      expect(bodyOf(conflict).error.code).toBe("SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED");
      expect(
        await db.database.prisma.electronicDocument.count({ where: { documentType: "06" } }),
      ).toBe(before + 1);
    }
  });
});

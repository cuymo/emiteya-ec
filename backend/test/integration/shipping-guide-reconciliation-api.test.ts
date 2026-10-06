// Reconciliación manual de una guía de remisión (add-shipping-guides, tarea 8.2, design D18 y D24),
// con los handlers reales y respuestas del SRI SINTÉTICAS: un administrador reconcilia una guía en
// revisión manual que pasa a autorizada; un operador recibe `403` y otra empresa `404`; un estado no
// reconciliable y una interacción en curso se rechazan; los eventos de la solicitud y de la
// finalización (`"06"` en `COMPLETED_AUDIT`) no llevan SOAP. Las reconciliaciones de los demás tipos
// siguen con sus propias pruebas, sin cambios.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ShippingGuideView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { receptionResponse, response } from "../support/sri-responses.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: ShippingGuideView & { id: string }; error: { code: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("reconciliación manual de una guía de remisión", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let sri: CreditNoteTransmission;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  /** Guía emitida por la API, en consignación, firmada y con su envío pendiente. */
  const signedGuide = async () => {
    const draft = await request(api.app)
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
            motive: "Consignación",
            support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
            details: [{ productId: a.productId, description: "Cemento 50 kg", quantity: "10" }],
          },
        ],
      });
    const emitted = await request(api.app)
      .post("/api/v1/shipping-guides")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: (draft.body as Body).data.id,
        expectedVersion: 1,
        exceptionDeclaration: { policyVersion: 1 },
      });
    expect(emitted.status, JSON.stringify(emitted.body)).toBe(201);
    return bodyOf(emitted).data as unknown as TestDocument;
  };
  /** Guía emitida por la API y llevada a revisión manual: recibida y con dos autorizaciones. */
  const inManualReview = async () => {
    const guide = await signedGuide();
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.leasePending(guide.id, "sri.transmit"), sri.context());
    sri.reply(guide, [sri.authorized(guide), sri.authorized(guide)]);
    await sri.authorize().run(await sri.leasePending(guide.id, "sri.authorize"), sri.context());
    expect(await stateOf(guide.id)).toBe("MANUAL_REVIEW");
    return guide;
  };
  const stateOf = async (id: string) =>
    (await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const reconcile = (id: string, cookie: string, reason = "El SRI confirmó la autorización") =>
    request(api.app)
      .post(`/api/v1/shipping-guides/${id}/reconciliations`)
      .set("Cookie", cookie)
      .send({ reason });

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guide_reconciliation_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-06T15:00:00Z"),
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "reconcilia-guia", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "reconcilia-guia-b", pool, p12Dir });
    sri = creditNoteTransmission(
      db.database.prisma,
      createPrismaJobStore(db.database.prisma, db.name),
    );
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("el administrador reconcilia una guía en revisión manual que pasa a autorizada", async () => {
    const guide = await inManualReview();
    const operator = await reconcile(guide.id, a.cookies.operator);
    expect(operator.status).toBe(403);
    const foreign = await reconcile(guide.id, b.cookies.admin);
    expect([foreign.status, bodyOf(foreign).error.code]).toEqual([404, "SHIPPING_GUIDE_NOT_FOUND"]);

    const prisma = db.database.prisma;
    const untouched = async () => ({
      capacities: await prisma.creditCapacity.findMany(),
      returns: await prisma.stockReturnCapacity.findMany(),
      movements: await prisma.stockMovement.count(),
      balances: await prisma.stockBalance.findMany(),
      roles: await prisma.party.findMany({
        select: { id: true, roles: true },
        orderBy: { id: "asc" },
      }),
      others: await prisma.electronicDocument.findMany({
        where: { documentType: { not: "06" } },
        orderBy: { id: "asc" },
      }),
    });
    const before = await untouched();
    const requested = await reconcile(guide.id, a.cookies.admin);
    expect([requested.status, bodyOf(requested).data.state]).toEqual([202, "MANUAL_REVIEW"]);
    // Mientras el job está activo, otra solicitud se rechaza sin programar otra.
    const again = await reconcile(guide.id, a.cookies.admin);
    expect([again.status, bodyOf(again).error.code]).toEqual([409, "SRI_INTERACTION_IN_PROGRESS"]);

    sri.reply(guide, [sri.authorized(guide)]);
    await sri.reconcile().run(await sri.leasePending(guide.id, "sri.reconcile"), sri.context());
    expect(await stateOf(guide.id)).toBe("AUTHORIZED");

    const events = await prisma.auditEvent.findMany({
      where: { companyId: a.companyId, action: { startsWith: "shipping_guide.reconciliation" } },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => [event.action, event.actorUserId])).toEqual([
      ["shipping_guide.reconciliation_requested", a.adminId],
      ["shipping_guide.reconciliation_completed", a.adminId],
    ]);
    expect(events[0]!.changes).toEqual({
      shippingGuideId: guide.id,
      documentNumber: guide.documentNumber,
      state: "MANUAL_REVIEW",
      reason: "El SRI confirmó la autorización",
    });
    expect(events[1]!.changes).toEqual({
      shippingGuideId: guide.id,
      documentNumber: guide.documentNumber,
      result: "AUTHORIZED",
      state: "AUTHORIZED",
    });
    // Sin cambiar el inventario, las capacidades, los roles ni los demás comprobantes.
    expect(await untouched()).toEqual(before);
    for (const event of events) {
      expect(JSON.stringify(event.changes)).not.toMatch(/soap|<|claveAcceso/i);
    }
    const detail = await request(api.app)
      .get(`/api/v1/shipping-guides/${guide.id}`)
      .set("Cookie", a.cookies.operator);
    expect(bodyOf(detail).data).toMatchObject({
      state: "AUTHORIZED",
      transmission: { authorization: { number: guide.accessKey } },
    });
    expect(bodyOf(detail).data.authorizedArtifact?.sizeBytes).toBeGreaterThan(0);
  });

  it("un estado que no se reconcilia se rechaza sin programarla, y un motivo vacío es inválido", async () => {
    const guide = await inManualReview();
    sri.reply(guide, [sri.authorized(guide)]);
    await reconcile(guide.id, a.cookies.admin);
    await sri.reconcile().run(await sri.leasePending(guide.id, "sri.reconcile"), sri.context());
    const jobs = await db.database.prisma.job.count({
      where: { documentId: guide.id, type: "sri.reconcile" },
    });
    const authorized = await reconcile(guide.id, a.cookies.admin);
    expect([authorized.status, bodyOf(authorized).error.code]).toEqual([
      409,
      "SHIPPING_GUIDE_NOT_RECONCILABLE",
    ]);
    expect(
      await db.database.prisma.job.count({
        where: { documentId: guide.id, type: "sri.reconcile" },
      }),
    ).toBe(jobs);
    const empty = await reconcile(guide.id, a.cookies.admin, "  ");
    expect(empty.status).toBe(400);
    // Devuelta tampoco se reconcilia.
    const returned = await signedGuide();
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
    expect(await stateOf(returned.id)).toBe("RETURNED");
    const rejected = await reconcile(returned.id, a.cookies.admin);
    expect([rejected.status, bodyOf(rejected).error.code]).toEqual([
      409,
      "SHIPPING_GUIDE_NOT_RECONCILABLE",
    ]);
    expect(
      await db.database.prisma.job.count({
        where: { documentId: returned.id, type: "sri.reconcile" },
      }),
    ).toBe(0);
  });
});

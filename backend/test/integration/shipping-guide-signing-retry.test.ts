// Reintento de la firma de una guía de remisión (add-shipping-guides, tarea 7.4, design D2 y D24):
// una guía que quedó reservada por un servicio ocupado se firma otro día con su mismo número, su
// misma clave, su misma fecha de emisión y su mismo snapshot, con `shipping_guide.signing_retried`.
// Una guía firmada se devuelve sin efecto ni auditoría; la de otra empresa o un comprobante de otro
// tipo responden `404`; sin sesión, `401`.
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ShippingGuideView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

type Body = {
  data: ShippingGuideView & { id: string; version: number };
  error: { code: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
type App = ReturnType<typeof buildTaxpayerApp>;
const TODAY = new Date("2026-10-06T15:00:00Z");
let clock = TODAY;

describe("reintento de la firma de una guía de remisión", () => {
  let db: MigratedSchema;
  let api: App;
  let busy: App;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  /** Guía emitida con `app`, en consignación: con el firmador ocupado queda reservada. */
  const emitted = async (app: App) => {
    const draft = await request(api.app)
      .post("/api/v1/shipping-guides/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        emissionPointId: a.emissionPointId,
        transporter: { source: "SELF" },
        plate: "PAA-1234",
        transportStart: "2026-10-06",
        transportEnd: "2026-10-09",
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
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const res = await request(app.app)
      .post("/api/v1/shipping-guides")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: bodyOf(draft).data.id,
        expectedVersion: 1,
        exceptionDeclaration: { policyVersion: 1 },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const retry = (app: App, id: string, cookie = a.cookies.operator) =>
    request(app.app).post(`/api/v1/shipping-guides/${id}/signing-attempts`).set("Cookie", cookie);
  const retried = (id: string) =>
    db.database.prisma.auditEvent.count({
      where: {
        action: "shipping_guide.signing_retried",
        changes: { path: ["shippingGuideId"], equals: id },
      },
    });

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guide_signing_retry");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const now = () => clock;
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY }, now });
    busy = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now,
      shippingGuides: {
        signer: {
          signDocument: () =>
            Promise.reject(Object.assign(new Error("ocupado"), { code: "CRYPTO_BUSY" })),
        },
      },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "reintento-guia-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "reintento-guia-b", pool, p12Dir });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("firma otro día la guía reservada con su mismo número, su misma clave, su misma fecha y su mismo snapshot", async () => {
    const guide = await emitted(busy);
    expect(guide.state).toBe("RESERVED");
    expect(guide.diagnostic).toMatchObject({
      code: "CRYPTO_BUSY",
      class: "RETRYABLE_OPERATIONAL",
    });
    const snapshot = (
      await db.database.prisma.electronicDocument.findUniqueOrThrow({ where: { id: guide.id } })
    ).snapshot;
    clock = new Date("2026-10-08T15:00:00Z");
    try {
      const res = await retry(api, guide.id);
      expect(res.status).toBe(200);
      expect(bodyOf(res).data).toMatchObject({
        id: guide.id,
        state: "SIGNED",
        documentNumber: guide.documentNumber,
        accessKey: guide.accessKey,
        issueDate: "2026-10-06",
        diagnostic: null,
      });
    } finally {
      clock = TODAY;
    }
    const document = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: guide.id },
    });
    expect(document.snapshot).toEqual(snapshot);
    const xml = Buffer.from(
      (
        await db.database.prisma.documentArtifact.findFirstOrThrow({
          where: { documentId: guide.id, kind: "SIGNED_XML" },
        })
      ).content,
    ).toString("utf8");
    expect(xml).toContain(`<claveAcceso>${guide.accessKey}</claveAcceso>`);
    expect(await retried(guide.id)).toBe(1);
    const event = await db.database.prisma.auditEvent.findFirstOrThrow({
      where: { action: "shipping_guide.signing_retried" },
    });
    expect(event).toMatchObject({
      actorUserId: a.operatorId,
      changes: {
        shippingGuideId: guide.id,
        documentNumber: guide.documentNumber,
        result: "SIGNED",
      },
    });
  });

  it("un reintento sin éxito deja el diagnóstico y lo audita; una guía firmada se devuelve sin efecto", async () => {
    const guide = await emitted(busy);
    const failed = await retry(busy, guide.id);
    expect([
      failed.status,
      bodyOf(failed).data.state,
      bodyOf(failed).data.diagnostic?.code,
    ]).toEqual([200, "RESERVED", "CRYPTO_BUSY"]);
    expect(await retried(guide.id)).toBe(1);
    await retry(api, guide.id);
    const unchanged = await retry(api, guide.id);
    expect([unchanged.status, bodyOf(unchanged).data.state]).toEqual([200, "SIGNED"]);
    expect(await retried(guide.id)).toBe(2);
  });

  it("una guía de otra empresa o un comprobante de otro tipo responden 404; sin sesión, 401", async () => {
    const guide = await emitted(api);
    const foreign = await retry(api, guide.id, b.cookies.admin);
    expect([foreign.status, bodyOf(foreign).error.code]).toEqual([404, "SHIPPING_GUIDE_NOT_FOUND"]);
    const consultedByOther = await request(api.app)
      .get(`/api/v1/shipping-guides/${guide.id}`)
      .set("Cookie", b.cookies.admin);
    expect(consultedByOther.status).toBe(404);
    const invoice = await insertDocument(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        points: [
          { establishmentId: a.establishmentId, emissionPointId: a.emissionPointId, code: "001" },
        ],
      },
      "RESERVED",
    );
    const notAGuide = await retry(api, invoice.id);
    expect([notAGuide.status, bodyOf(notAGuide).error.code]).toEqual([
      404,
      "SHIPPING_GUIDE_NOT_FOUND",
    ]);
    expect(
      (await request(api.app).post(`/api/v1/shipping-guides/${guide.id}/signing-attempts`)).status,
    ).toBe(401);
  });
});

// RIDE de una guía de remisión en el job, el pool y la bandeja (add-shipping-guides, tarea 10.2,
// design D20): una guía emitida por la API, recibida y autorizada con respuestas del SRI SINTÉTICAS
// programa su RIDE en la misma operación que la autorización; el handler lo dibuja con la
// distribución de la guía y lo guarda una vez con su procedencia; un segundo intento no genera otro;
// la bandeja lo lista con el tipo 06 y sus destinatarios, lo descarga verificado y la solicitud de
// impresión entrega el mismo RIDE.
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ShippingGuideView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  RIDE_BACKOFF,
  RIDE_JOB_TYPE,
} from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createRideHandler } from "../../src/modules/fiscal/application/archive/ride-handler.ts";
import { createRideUnitOfWork } from "../../src/modules/fiscal/infrastructure/archive/ride-unit-of-work.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import {
  SHIPPING_GUIDE_RIDE_VERSIONS,
  createInProcessRideRenderer,
} from "../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { createConfigurationLogoReader } from "../../src/modules/taxpayer/infrastructure/prisma-configuration-assets.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { pageTexts } from "../support/pdf-inspection.ts";
import { receptionResponse, response } from "../support/sri-responses.ts";
import { buildArchiveApp } from "./archive-api-harness.ts";
import { insertAuthorizedInvoice } from "./credit-notes-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: ShippingGuideView & { id: string; version: number } };
const bodyOf = (res: { body: unknown }) => res.body as Body;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const SETTINGS = { maxAttempts: 3, backoff: RIDE_BACKOFF };

describe("RIDE de una guía de remisión en el job y la bandeja", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let archive: ReturnType<typeof buildArchiveApp>;
  let a: ReadyCompany;
  let store: JobStore;
  let sri: CreditNoteTransmission;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  /** El RIDE guardado tal como lo entrega la descarga, en bytes. */
  const downloadRide = (documentId: string) =>
    request(archive.app)
      .get(`/api/v1/documents/${documentId}/ride`)
      .set("Cookie", a.cookies.operator)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
  const rideHandler = () =>
    createRideHandler({
      db: db.database.prisma,
      documents: createDocumentRepository(db.database.prisma),
      artifacts: createArtifactStore(db.database.prisma),
      logos: createConfigurationLogoReader(db.database.prisma),
      renderer: createInProcessRideRenderer(assets.fonts),
      uow: createRideUnitOfWork(db.database.prisma),
      jobs: store,
      settings: SETTINGS,
      logger: { info: () => {}, warn: () => {} },
      random: () => 0.5,
    });

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guide_ride");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-06T15:00:00Z"),
    });
    archive = buildArchiveApp(db);
    a = await readyCompany(api, db, { slug: "ride-guia", pool, p12Dir: inject("p12FixturesDir") });
    store = createPrismaJobStore(db.database.prisma, db.name);
    sri = creditNoteTransmission(db.database.prisma, store);
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("al autorizarse programa su RIDE, que se guarda una vez con su procedencia, se descarga verificado y se imprime el mismo", async () => {
    const invoice = await insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [{ productId: a.productId, quantity: "10", unitPrice: "8.75" }],
    );
    const draft = await request(api.app)
      .post("/api/v1/shipping-guides/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        emissionPointId: a.emissionPointId,
        transporter: { source: "SELF" },
        plate: "PAA-1234",
        transportStart: "2026-10-06",
        transportEnd: "2026-10-07",
        recipients: [
          {
            recipient: { kind: "PARTY", partyId: a.customerId },
            address: "Av. Quito y Guayaquil",
            motive: "Venta",
            route: "Quito - Guayaquil",
            support: { kind: "INTERNAL_INVOICE", invoiceId: invoice.id },
            details: [{ productId: a.productId, description: "Cemento 50 kg", quantity: "10" }],
          },
          {
            recipient: { kind: "PARTY", partyId: a.supplierId },
            address: "Calle Sucre 12",
            motive: "Consignación",
            support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
            details: [{ productId: null, description: "Varilla 12 mm", quantity: "2.5" }],
          },
        ],
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const emitted = await request(api.app)
      .post("/api/v1/shipping-guides")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: bodyOf(draft).data.id,
        expectedVersion: bodyOf(draft).data.version,
        exceptionDeclaration: { policyVersion: 1 },
      });
    expect(emitted.status, JSON.stringify(emitted.body)).toBe(201);
    const guide = bodyOf(emitted).data as unknown as TestDocument;
    const signed = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: guide.id, kind: "SIGNED_XML" },
    });
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.leasePending(guide.id, "sri.transmit"), sri.context());
    // El SRI devuelve la guía autorizada con los mismos bytes firmados.
    sri.reply(guide, [
      sri.authorized(guide, {
        comprobante: `<![CDATA[${Buffer.from(signed.content).toString("utf8")}]]>`,
      }),
    ]);
    await sri.authorize().run(await sri.leasePending(guide.id, "sri.authorize"), sri.context());

    // El job del RIDE nació con la autorización, en la misma transacción.
    const pending = await db.database.prisma.job.findMany({
      where: { documentId: guide.id, type: RIDE_JOB_TYPE },
    });
    expect(pending.map((job) => job.status)).toEqual(["PENDING"]);

    await rideHandler().run(await sri.leasePending(guide.id, RIDE_JOB_TYPE), sri.context());
    const rides = await db.database.prisma.documentArtifact.findMany({
      where: { documentId: guide.id, kind: "RIDE_PDF" },
    });
    expect(rides).toHaveLength(1);
    const authorizedXml = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: guide.id, kind: "AUTHORIZED_XML" },
    });
    expect(rides[0]!.metadata).toMatchObject({
      ...SHIPPING_GUIDE_RIDE_VERSIONS,
      source: {
        kind: "AUTHORIZED_XML",
        sha256: authorizedXml.sha256,
        provenance: "AUTHORIZED_XML",
      },
      authorizationNumber: guide.accessKey,
    });
    const text = (await pageTexts(Buffer.from(rides[0]!.content))).join(" ");
    expect(text).toContain("GUÍA DE REMISIÓN");
    expect(text).toContain("Identificación (Transportista): 1790012345001");
    expect(text).toContain("Placa: PAA-1234");
    expect(text).toContain(`Comprobante de Venta: FACTURA ${invoice.documentNumber}`);
    expect(text).toContain("Razón Social / Nombres y Apellidos: PROVEEDORA DEL SUR S.A.");
    expect(text).toContain("2.5 Varilla 12 mm");
    expect(text).not.toMatch(/VALOR TOTAL|Forma de pago|Precio/);

    // Generado una vez: otro intento del job no dibuja otro RIDE.
    await store.enqueueIn(db.database.prisma, {
      companyId: a.companyId,
      documentId: guide.id,
      type: RIDE_JOB_TYPE,
      dedupeKey: `${RIDE_JOB_TYPE}:${guide.id}:otra-vez`,
      runAt: new Date(),
      maxAttempts: SETTINGS.maxAttempts,
    });
    await rideHandler().run(await sri.leasePending(guide.id, RIDE_JOB_TYPE), sri.context());
    expect(
      await db.database.prisma.documentArtifact.count({
        where: { documentId: guide.id, kind: "RIDE_PDF" },
      }),
    ).toBe(1);

    const download = await downloadRide(guide.id);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toMatch(/application\/pdf/);
    expect(sha256(download.body as Buffer)).toBe(rides[0]!.sha256);
    // Imprimir: la solicitud se registra y la interfaz pide después el mismo RIDE.
    const print = await request(archive.app)
      .post(`/api/v1/documents/${guide.id}/print-requests`)
      .set("Cookie", a.cookies.operator);
    expect(print.status, JSON.stringify(print.body)).toBe(201);
    const printed = await downloadRide(guide.id);
    expect(sha256(printed.body as Buffer)).toBe(rides[0]!.sha256);
    // El historial de entregas de la guía registra las descargas y la solicitud de impresión.
    const deliveries = await request(archive.app)
      .get(`/api/v1/documents/${guide.id}/deliveries`)
      .set("Cookie", a.cookies.operator);
    expect(deliveries.status).toBe(200);
    const { items } = (
      deliveries.body as { data: { items: { event: string; artifactKind: string }[] } }
    ).data;
    expect(items.map((d) => `${d.event}:${d.artifactKind}`).sort()).toEqual([
      "DOWNLOAD:RIDE_PDF",
      "DOWNLOAD:RIDE_PDF",
      "PRINT_REQUESTED:RIDE_PDF",
    ]);
    const list = await request(archive.app)
      .get("/api/v1/documents?documentType=06")
      .set("Cookie", a.cookies.operator);
    expect(
      (
        list.body as {
          data: { id: string; documentType: string; recipients: unknown; total: unknown }[];
        }
      ).data.map((d) => [d.id, d.documentType, d.recipients, d.total]),
    ).toEqual([[guide.id, "06", { count: 2, name: null }, null]]);
  });
});

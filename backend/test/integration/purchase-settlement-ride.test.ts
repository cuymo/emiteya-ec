// RIDE de una liquidación de compra en el job, el pool y la bandeja (add-purchase-settlements, tarea
// 10.2, design D19): una liquidación emitida por la API, recibida y autorizada con respuestas del SRI
// SINTÉTICAS programa su RIDE en la misma operación que la autorización; el handler lo dibuja con la
// distribución de la liquidación, con las denominaciones de las formas de pago de su snapshot, y lo
// guarda una vez con su procedencia; un segundo intento no genera otro; se descarga verificado, la
// solicitud de impresión entrega el mismo RIDE y el historial de entregas registra ambas.
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PURCHASE_SETTLEMENT_STATEMENTS, type PurchaseSettlementView } from "@facturador/contracts";
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
  PURCHASE_SETTLEMENT_RIDE_VERSIONS,
  createInProcessRideRenderer,
} from "../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { createConfigurationLogoReader } from "../../src/modules/taxpayer/infrastructure/prisma-configuration-assets.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { pageTexts } from "../support/pdf-inspection.ts";
import { receptionResponse, response } from "../support/sri-responses.ts";
import { buildArchiveApp } from "./archive-api-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: PurchaseSettlementView & { id: string; version: number } };
const bodyOf = (res: { body: unknown }) => res.body as Body;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const SETTINGS = { maxAttempts: 3, backoff: RIDE_BACKOFF };

describe("RIDE de una liquidación de compra en el job y la bandeja", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let archive: ReturnType<typeof buildArchiveApp>;
  let a: ReadyCompany;
  let store: JobStore;
  let sri: CreditNoteTransmission;
  let supplierId: string;
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
    db = await createMigratedSchema("purchase_settlement_ride");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-07T15:00:00Z"),
    });
    archive = buildArchiveApp(db);
    a = await readyCompany(api, db, {
      slug: "ride-liquidacion",
      pool,
      p12Dir: inject("p12FixturesDir"),
    });
    store = createPrismaJobStore(db.database.prisma, db.name);
    sri = creditNoteTransmission(db.database.prisma, store);
    supplierId = await insertPurchaseSupplier(db.database.prisma, a, "0102030405", {
      legalName: "María Quishpe",
    });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("al autorizarse programa su RIDE, que se guarda una vez con su procedencia, se descarga verificado y se imprime el mismo", async () => {
    const draft = await request(api.app)
      .post("/api/v1/purchase-settlements/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        emissionPointId: a.emissionPointId,
        supplierPartyId: supplierId,
        lines: [
          {
            mainCode: "CAC-01",
            description: "Saco de cacao en grano, 45 kg",
            unit: "saco",
            quantity: "10",
            unitPrice: "4.50",
            discount: "5.00",
            ivaRate: "4",
          },
          {
            description: "Jornal de cosecha",
            quantity: "2",
            unitPrice: "30.00",
            ivaRate: "0",
          },
        ],
        payments: [
          { paymentMethod: "01", total: "50.00", term: "0", timeUnit: "días" },
          { paymentMethod: "20", total: "56.00", term: "30", timeUnit: "días" },
        ],
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const emitted = await request(api.app)
      .post("/api/v1/purchase-settlements")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: bodyOf(draft).data.id,
        expectedVersion: bodyOf(draft).data.version,
        declarations: { policyVersion: 1, statements: [...PURCHASE_SETTLEMENT_STATEMENTS] },
      });
    expect(emitted.status, JSON.stringify(emitted.body)).toBe(201);
    const settlement = bodyOf(emitted).data as unknown as TestDocument & { documentNumber: string };
    const signed = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: settlement.id, kind: "SIGNED_XML" },
    });
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.leasePending(settlement.id, "sri.transmit"), sri.context());
    // El SRI devuelve la liquidación autorizada con los mismos bytes firmados.
    sri.reply(settlement, [
      sri.authorized(settlement, {
        comprobante: `<![CDATA[${Buffer.from(signed.content).toString("utf8")}]]>`,
      }),
    ]);
    await sri
      .authorize()
      .run(await sri.leasePending(settlement.id, "sri.authorize"), sri.context());

    // El job del RIDE nació con la autorización, en la misma transacción.
    const pending = await db.database.prisma.job.findMany({
      where: { documentId: settlement.id, type: RIDE_JOB_TYPE },
    });
    expect(pending.map((job) => job.status)).toEqual(["PENDING"]);

    await rideHandler().run(await sri.leasePending(settlement.id, RIDE_JOB_TYPE), sri.context());
    const rides = await db.database.prisma.documentArtifact.findMany({
      where: { documentId: settlement.id, kind: "RIDE_PDF" },
    });
    expect(rides).toHaveLength(1);
    const authorizedXml = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: settlement.id, kind: "AUTHORIZED_XML" },
    });
    expect(rides[0]!.metadata).toMatchObject({
      ...PURCHASE_SETTLEMENT_RIDE_VERSIONS,
      source: {
        kind: "AUTHORIZED_XML",
        sha256: authorizedXml.sha256,
        provenance: "AUTHORIZED_XML",
      },
      authorizationNumber: settlement.accessKey,
    });
    const text = (await pageTexts(Buffer.from(rides[0]!.content))).join(" ");
    expect(text).toContain("LIQUIDACIÓN DE COMPRA DE BIENES Y PRESTACIÓN DE SERVICIOS");
    expect(text).toContain(`No. ${settlement.documentNumber}`);
    expect(text).toContain("Razón Social / Nombres y Apellidos: María Quishpe");
    expect(text).toContain("Identificación: 0102030405");
    expect(text).toContain("Dirección: Comunidad San Pablo, Cayambe");
    expect(text).toContain("CAC-01 10 Saco de cacao en grano, 45 kg saco 4.5 5.00 40.00");
    // Las denominaciones de las formas de pago salen del snapshot.
    expect(text).toContain("01 - SIN UTILIZACION DEL SISTEMA FINANCIERO 0 días 50.00");
    expect(text).toContain("20 - OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO 30 días 56.00");
    expect(text).toContain("IVA 15% 6.00");
    expect(text).toContain("VALOR TOTAL 106.00");
    expect(text).not.toMatch(/FACTURA|TOTAL DESCUENTO|Placa|Subsidio/);

    // Generado una vez: otro intento del job no dibuja otro RIDE.
    await store.enqueueIn(db.database.prisma, {
      companyId: a.companyId,
      documentId: settlement.id,
      type: RIDE_JOB_TYPE,
      dedupeKey: `${RIDE_JOB_TYPE}:${settlement.id}:otra-vez`,
      runAt: new Date(),
      maxAttempts: SETTINGS.maxAttempts,
    });
    await rideHandler().run(await sri.leasePending(settlement.id, RIDE_JOB_TYPE), sri.context());
    expect(
      await db.database.prisma.documentArtifact.count({
        where: { documentId: settlement.id, kind: "RIDE_PDF" },
      }),
    ).toBe(1);

    const download = await downloadRide(settlement.id);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toMatch(/application\/pdf/);
    expect(download.headers["content-disposition"]).toContain("liquidacion-de-compra");
    expect(sha256(download.body as Buffer)).toBe(rides[0]!.sha256);
    // Imprimir: la solicitud se registra y la interfaz pide después el mismo RIDE.
    const print = await request(archive.app)
      .post(`/api/v1/documents/${settlement.id}/print-requests`)
      .set("Cookie", a.cookies.operator);
    expect(print.status, JSON.stringify(print.body)).toBe(201);
    const printed = await downloadRide(settlement.id);
    expect(sha256(printed.body as Buffer)).toBe(rides[0]!.sha256);
    // El historial de entregas registra las descargas y la solicitud de impresión.
    const deliveries = await request(archive.app)
      .get(`/api/v1/documents/${settlement.id}/deliveries`)
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
  });
});

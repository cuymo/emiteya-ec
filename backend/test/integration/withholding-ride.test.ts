// RIDE de un comprobante de retención en el job, el pool y la bandeja (add-withholding-receipts,
// tarea 10.2, design D19): una retención emitida por la API, recibida y autorizada con respuestas del
// SRI SINTÉTICAS programa su RIDE en la misma operación que la autorización; el handler lo dibuja con
// la distribución de la retención y las denominaciones de su snapshot, y lo guarda una vez con su
// procedencia; un segundo intento no genera otro; la bandeja lo lista con el tipo 07 y lo descarga
// verificado.
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { WithholdingReceiptView } from "@facturador/contracts";
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
  WITHHOLDING_RIDE_VERSIONS,
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
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: WithholdingReceiptView & { id: string; version: number } };
const bodyOf = (res: { body: unknown }) => res.body as Body;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const SETTINGS = { maxAttempts: 3, backoff: RIDE_BACKOFF };

describe("RIDE de un comprobante de retención en el job y la bandeja", () => {
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
    db = await createMigratedSchema("withholding_ride");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    // 10:00 del 6 de octubre de 2026 en Ecuador: la retención resuelve el bloque vigente del ATS.
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now: () => new Date("2026-10-06T15:00:00Z"),
    });
    archive = buildArchiveApp(db);
    a = await readyCompany(api, db, { slug: "ride-ret", pool, p12Dir: inject("p12FixturesDir") });
    store = createPrismaJobStore(db.database.prisma, db.name);
    sri = creditNoteTransmission(db.database.prisma, store);
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("al autorizarse programa su RIDE, que se guarda una vez con su procedencia y se descarga verificado", async () => {
    const draft = await request(api.app)
      .post("/api/v1/withholding-receipts/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
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
            withholdings: [
              { tax: "1", entryKey: "312", base: "100.00" },
              { tax: "2", entryKey: "9", base: "15.00" },
            ],
          },
        ],
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const emitted = await request(api.app)
      .post("/api/v1/withholding-receipts")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: bodyOf(draft).data.id, expectedVersion: bodyOf(draft).data.version });
    expect(emitted.status, JSON.stringify(emitted.body)).toBe(201);
    const note = bodyOf(emitted).data as unknown as TestDocument;
    const signed = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: note.id, kind: "SIGNED_XML" },
    });
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.leasePending(note.id, "sri.transmit"), sri.context());
    // El SRI devuelve el comprobante autorizado con los mismos bytes firmados.
    sri.reply(note, [
      sri.authorized(note, {
        comprobante: `<![CDATA[${Buffer.from(signed.content).toString("utf8")}]]>`,
      }),
    ]);
    await sri.authorize().run(await sri.leasePending(note.id, "sri.authorize"), sri.context());

    // El job del RIDE nació con la autorización, en la misma transacción.
    const pending = await db.database.prisma.job.findMany({
      where: { documentId: note.id, type: RIDE_JOB_TYPE },
    });
    expect(pending.map((job) => job.status)).toEqual(["PENDING"]);

    await rideHandler().run(await sri.leasePending(note.id, RIDE_JOB_TYPE), sri.context());
    const rides = await db.database.prisma.documentArtifact.findMany({
      where: { documentId: note.id, kind: "RIDE_PDF" },
    });
    expect(rides).toHaveLength(1);
    const authorizedXml = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: note.id, kind: "AUTHORIZED_XML" },
    });
    expect(rides[0]!.metadata).toMatchObject({
      ...WITHHOLDING_RIDE_VERSIONS,
      source: {
        kind: "AUTHORIZED_XML",
        sha256: authorizedXml.sha256,
        provenance: "AUTHORIZED_XML",
      },
      authorizationNumber: note.accessKey,
    });
    const text = (await pageTexts(Buffer.from(rides[0]!.content))).join(" ");
    expect(text).toContain("COMPROBANTE DE RETENCIÓN");
    expect(text).toContain("PROVEEDORA DEL SUR S.A.");
    // Las denominaciones del tipo de documento y del impuesto salen del snapshot de la retención.
    expect(text).toContain("Factura 001-001-000000123 01/10/2026 10/2026 100.00 RENTA");
    expect(text).toContain("Factura 001-001-000000123 01/10/2026 10/2026 15.00 IVA");
    expect(text).toContain("2 - IVA 4 100.00 15 15.00");
    expect(text).not.toMatch(/VALOR TOTAL|Forma de pago/);

    // Generado una vez: otro intento del job no dibuja otro RIDE.
    await store.enqueueIn(db.database.prisma, {
      companyId: a.companyId,
      documentId: note.id,
      type: RIDE_JOB_TYPE,
      dedupeKey: `${RIDE_JOB_TYPE}:${note.id}:otra-vez`,
      runAt: new Date(),
      maxAttempts: SETTINGS.maxAttempts,
    });
    await rideHandler().run(await sri.leasePending(note.id, RIDE_JOB_TYPE), sri.context());
    expect(
      await db.database.prisma.documentArtifact.count({
        where: { documentId: note.id, kind: "RIDE_PDF" },
      }),
    ).toBe(1);

    const download = await request(archive.app)
      .get(`/api/v1/documents/${note.id}/ride`)
      .set("Cookie", a.cookies.operator)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toMatch(/application\/pdf/);
    expect(sha256(download.body as Buffer)).toBe(rides[0]!.sha256);
    const list = await request(archive.app)
      .get("/api/v1/documents?documentType=07")
      .set("Cookie", a.cookies.operator);
    expect(
      (list.body as { data: { id: string; documentType: string }[] }).data.map((d) => [
        d.id,
        d.documentType,
      ]),
    ).toEqual([[note.id, "07"]]);
  });
});

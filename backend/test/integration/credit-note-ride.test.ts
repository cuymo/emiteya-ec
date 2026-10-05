// RIDE de una nota de crédito en el job, el pool y la bandeja (add-credit-notes, tarea 11.2, design
// D14 y D15): una nota emitida por la API, recibida y autorizada con respuestas del SRI SINTÉTICAS
// programa su RIDE en la misma operación que la autorización; el handler lo dibuja con la
// distribución de la nota y lo guarda una vez con su procedencia; la bandeja lo descarga verificado.
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CreditNoteView } from "@facturador/contracts";
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
  CREDIT_NOTE_RIDE_VERSIONS,
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
import { insertProduct } from "./inventory-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

type Body = { data: CreditNoteView & { id: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const SETTINGS = { maxAttempts: 3, backoff: RIDE_BACKOFF };

describe("RIDE de una nota de crédito en el job y la bandeja", () => {
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
    db = await createMigratedSchema("credit_note_ride");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    archive = buildArchiveApp(db);
    a = await readyCompany(api, db, { slug: "ride-nc", pool, p12Dir: inject("p12FixturesDir") });
    store = createPrismaJobStore(db.database.prisma, db.name);
    sri = creditNoteTransmission(db.database.prisma, store);
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("al autorizarse programa su RIDE, que se guarda una vez con su procedencia y se descarga verificado", async () => {
    const product = await insertProduct(db.database.prisma, {
      companyId: a.companyId,
      adminId: a.adminId,
      points: [],
    });
    const invoice = await insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [{ productId: product, quantity: "4", unitPrice: "10.00" }],
    );
    const draft = await request(api.app)
      .post("/api/v1/credit-notes/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        invoiceId: invoice.id,
        emissionPointId: a.emissionPointId,
        cause: "RETURN",
        reason: "Devolución de mercadería",
        lines: [{ position: 1, quantity: "1" }],
      });
    const emitted = await request(api.app)
      .post("/api/v1/credit-notes")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({
        draftId: (draft.body as Body).data.id,
        expectedVersion: 1,
        declarations: {
          version: 1,
          statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
        },
      });
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
      ...CREDIT_NOTE_RIDE_VERSIONS,
      source: {
        kind: "AUTHORIZED_XML",
        sha256: authorizedXml.sha256,
        provenance: "AUTHORIZED_XML",
      },
      authorizationNumber: note.accessKey,
    });
    const text = (await pageTexts(Buffer.from(rides[0]!.content))).join(" ");
    expect(text).toContain("NOTA DE CRÉDITO");
    expect(text).toContain(`Comprobante que se modifica: FACTURA ${invoice.documentNumber}`);

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
      .get("/api/v1/documents?documentType=04")
      .set("Cookie", a.cookies.operator);
    expect(
      (list.body as { data: { id: string; documentType: string }[] }).data.map((d) => [
        d.id,
        d.documentType,
      ]),
    ).toEqual([[note.id, "04"]]);
  });
});

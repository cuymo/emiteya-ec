// Reintento de una generación detenida del RIDE sobre HTTP (add-document-archive, tarea 9.1,
// design D5): programa un job manual que genera el RIDE; nunca reemplaza uno existente, nunca deja
// dos jobs activos, nunca cambia el estado fiscal y no se audita.
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { DocumentSummaryView } from "@facturador/contracts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createRideHandler } from "../../src/modules/fiscal/application/archive/ride-handler.ts";
import {
  RIDE_BACKOFF,
  RIDE_JOB_TYPE,
  rideJob,
} from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createRideUnitOfWork } from "../../src/modules/fiscal/infrastructure/archive/ride-unit-of-work.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { createInProcessRideRenderer } from "../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { createConfigurationLogoReader } from "../../src/modules/taxpayer/infrastructure/prisma-configuration-assets.ts";
import type { Job } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { archiveCompany, buildArchiveApp, type ArchiveCompany } from "./archive-api-harness.ts";
import { insertArchiveDocument, nextInvoice, sha256 } from "./archive-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { leasedJob } from "./transmission-harness.ts";

const p12Dir = inject("p12FixturesDir");
const SETTINGS = { maxAttempts: 5, backoff: RIDE_BACKOFF };
type Body = { data: DocumentSummaryView; error: { code: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

describe("reintento de una generación detenida del RIDE sobre HTTP", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let api: ReturnType<typeof buildArchiveApp>;
  let a: ArchiveCompany;
  let b: ArchiveCompany;

  const retry = (company: ArchiveCompany | null, documentId: string) => {
    const req = request(api.app).post(`/api/v1/documents/${documentId}/ride-attempts`);
    return company ? req.set("Cookie", company.cookies.operator) : req;
  };
  const rideJobs = (documentId: string) =>
    prisma.job.findMany({
      where: { documentId, type: RIDE_JOB_TYPE },
      orderBy: { createdAt: "asc" },
    });
  /** Autorizado con su generación del RIDE detenida, como tras un fallo determinista. */
  async function stopped(company: ArchiveCompany = a) {
    const document = await insertArchiveDocument(prisma, company, await nextInvoice(p12Dir));
    const job = await leasedJob(store, prisma, rideJob(document, SETTINGS, new Date()));
    await store.stop(
      prisma,
      job,
      { code: "RIDE_RENDER_TIMEOUT", errorClass: "RETRYABLE" },
      new Date(),
    );
    return document;
  }

  beforeAll(async () => {
    db = await createMigratedSchema("ride_attempts_api");
    prisma = db.database.prisma;
    store = createPrismaJobStore(prisma, db.name);
    api = buildArchiveApp(db);
    a = await archiveCompany(db, api, "Empresa A");
    b = await archiveCompany(db, api, "Empresa B");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("programa un job manual que genera el RIDE, con el comprobante autorizado", async () => {
    const document = await stopped();
    const res = await retry(a, document.id);
    expect(res.status).toBe(202);
    expect(bodyOf(res).data.rideGeneration).toEqual({
      status: "PENDING",
      reason: null,
      stoppedAt: null,
      retryable: false,
    });
    const jobs = await rideJobs(document.id);
    expect(jobs.map((job) => [job.status, job.origin, job.requestedBy])).toEqual([
      ["STOPPED", "AUTOMATIC", null],
      ["PENDING", "MANUAL", a.operatorId],
    ]);
    // El runner lo toma y genera el RIDE.
    const leased = (await prisma.job.update({
      where: { id: jobs[1]!.id },
      data: {
        status: "LEASED",
        leaseOwner: "worker-de-prueba",
        leaseExpiresAt: new Date(Date.now() + 60_000),
        attemptCount: { increment: 1 },
      },
    })) as unknown as Job;
    const assets = loadRideAssets(defaultRideFontsDirectory());
    if (!assets.ok) throw new Error("fuentes");
    await createRideHandler({
      db: prisma,
      documents: createDocumentRepository(prisma),
      artifacts: createArtifactStore(prisma),
      logos: createConfigurationLogoReader(prisma),
      renderer: createInProcessRideRenderer(assets.fonts),
      uow: createRideUnitOfWork(prisma),
      jobs: store,
      settings: SETTINGS,
      logger: { info: () => {}, warn: () => {} },
    }).run(leased, { signal: new AbortController().signal, now: () => new Date() });
    const summary = await request(api.app)
      .get(`/api/v1/documents/${document.id}`)
      .set("Cookie", a.cookies.admin);
    expect(bodyOf(summary).data.documents.ride).toBe("AVAILABLE");
    expect(bodyOf(summary).data.state).toBe("AUTHORIZED");
  });

  it("con un RIDE guardado se rechaza y el RIDE no cambia", async () => {
    const document = await stopped();
    const pdf = Buffer.from("%PDF-1.3\n%%EOF\n");
    await prisma.documentArtifact.create({
      data: {
        companyId: a.companyId,
        documentId: document.id,
        kind: "RIDE_PDF",
        mediaType: "application/pdf",
        content: new Uint8Array(pdf),
        sizeBytes: pdf.length,
        sha256: sha256(pdf),
        metadata: {},
      },
    });
    const res = await retry(a, document.id);
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("RIDE_ALREADY_AVAILABLE");
    const [ride] = await prisma.documentArtifact.findMany({
      where: { documentId: document.id, kind: "RIDE_PDF" },
    });
    expect(ride!.sha256).toBe(sha256(pdf));
    expect((await rideJobs(document.id)).map((job) => job.status)).toEqual(["STOPPED"]);
  });

  it("con una generación programada o en curso se rechaza sin programar otra", async () => {
    const document = await insertArchiveDocument(prisma, a, await nextInvoice(p12Dir));
    await store.enqueueIn(prisma, rideJob(document, SETTINGS, new Date()));
    const res = await retry(a, document.id);
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("RIDE_GENERATION_IN_PROGRESS");
    expect(await rideJobs(document.id)).toHaveLength(1);
    // En curso: el job está arrendado por un runner.
    const running = await insertArchiveDocument(prisma, a, await nextInvoice(p12Dir));
    await leasedJob(store, prisma, rideJob(running, SETTINGS, new Date()));
    const leased = await retry(a, running.id);
    expect(leased.status).toBe(409);
    expect(bodyOf(leased).error.code).toBe("RIDE_GENERATION_IN_PROGRESS");
    expect(await rideJobs(running.id)).toHaveLength(1);
  });

  it("un comprobante que no está autorizado se rechaza", async () => {
    const document = await insertArchiveDocument(prisma, a, await nextInvoice(p12Dir), {
      state: "RECEIVED",
    });
    const res = await retry(a, document.id);
    expect(res.status).toBe(409);
    expect(bodyOf(res).error.code).toBe("DOCUMENT_NOT_AUTHORIZED");
  });

  it("dos reintentos simultáneos programan una sola generación", async () => {
    const document = await stopped();
    const results = await Promise.all([retry(a, document.id), retry(a, document.id)]);
    expect(results.map((res) => res.status).sort()).toEqual([202, 409]);
    expect(
      (await rideJobs(document.id)).filter((job) => ["PENDING", "LEASED"].includes(job.status)),
    ).toHaveLength(1);
  });

  it("sin sesión o con un comprobante de otra empresa no tiene efecto, y nada se audita", async () => {
    const before = await prisma.auditEvent.count();
    const foreign = await stopped(b);
    expect((await retry(null, foreign.id)).status).toBe(401);
    const res = await retry(a, foreign.id);
    expect(res.status).toBe(404);
    expect(bodyOf(res).error.code).toBe("DOCUMENT_NOT_FOUND");
    expect((await rideJobs(foreign.id)).map((job) => job.status)).toEqual(["STOPPED"]);
    const own = await stopped();
    expect((await retry(a, own.id)).status).toBe(202);
    expect(await prisma.auditEvent.count()).toBe(before);
  });
});

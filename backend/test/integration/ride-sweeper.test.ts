// Barrido del RIDE (add-document-archive, design D5): la defensa secundaria y el backfill. Encola
// exactamente un job por cada autorizado sin RIDE ni job, es repetible y concurrente sin duplicar,
// y nunca reactiva una generación detenida.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import {
  RIDE_BACKOFF,
  RIDE_JOB_TYPE,
  rideJob,
} from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createRideSweeper } from "../../src/modules/fiscal/infrastructure/archive/ride-sweeper.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, leasedJob, sha256 } from "./transmission-harness.ts";

const SETTINGS = { maxAttempts: 5, backoff: RIDE_BACKOFF };

describe("barrido del RIDE", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;

  const sweeper = () =>
    createRideSweeper({
      prisma,
      jobs: store,
      settings: SETTINGS,
      logger: { info: () => {}, error: () => {} },
    });
  const rideJobs = (documentId: string) =>
    prisma.job.findMany({ where: { documentId, type: RIDE_JOB_TYPE } });

  beforeAll(async () => {
    db = await createMigratedSchema("ride_sweeper");
    prisma = db.database.prisma;
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Empresa Barrido", 1);
  });

  afterAll(async () => {
    await db.drop();
  });

  it("encola uno por autorizado sin RIDE ni job, repetible y concurrente sin duplicar", async () => {
    const authorized = [
      await insertDocument(prisma, company, "AUTHORIZED"),
      await insertDocument(prisma, company, "AUTHORIZED"),
      await insertDocument(prisma, company, "AUTHORIZED"),
    ];
    const others = [
      await insertDocument(prisma, company, "SIGNED"),
      await insertDocument(prisma, company, "RECEIVED"),
      await insertDocument(prisma, company, "NOT_AUTHORIZED"),
    ];
    const [first, second] = await Promise.all([sweeper().sweep(), sweeper().sweep()]);
    expect(first + second).toBe(3);
    expect(await sweeper().sweep()).toBe(0);
    for (const document of authorized) {
      expect(await rideJobs(document.id)).toMatchObject([
        { status: "PENDING", origin: "AUTOMATIC", maxAttempts: 5 },
      ]);
    }
    for (const document of others) expect(await rideJobs(document.id)).toEqual([]);
  });

  it("un autorizado que ya tiene RIDE no recibe job", async () => {
    const document = await insertDocument(prisma, company, "AUTHORIZED");
    const pdf = Buffer.from("%PDF-1.3\n%%EOF\n");
    await prisma.documentArtifact.create({
      data: {
        companyId: company.companyId,
        documentId: document.id,
        kind: "RIDE_PDF",
        mediaType: "application/pdf",
        content: new Uint8Array(pdf),
        sizeBytes: pdf.length,
        sha256: sha256(pdf),
        metadata: {},
      },
    });
    await sweeper().sweep();
    expect(await rideJobs(document.id)).toEqual([]);
  });

  it("no reactiva una generación detenida", async () => {
    const document = await insertDocument(prisma, company, "AUTHORIZED");
    const job = await leasedJob(store, prisma, rideJob(document, SETTINGS, new Date()));
    await store.stop(
      prisma,
      job,
      { code: "RIDE_GLYPH_MISSING", errorClass: "DETERMINISTIC" },
      new Date(),
    );
    await sweeper().sweep();
    expect((await rideJobs(document.id)).map((row) => row.status)).toEqual(["STOPPED"]);
  });
});

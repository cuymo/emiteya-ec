// Procedimiento común de los handlers (add-sri-transmission, tarea 7.2, design D8): la evidencia se
// confirma antes de clasificar; una caída entre la TX A y la TX B se clasifica al retomar sin llamar
// al SRI; un parser que falla deja `UNPARSEABLE` con la evidencia intacta; un arriendo perdido entre
// A y B no tiene efecto; y los logs no llevan XML ni SOAP. El paso de prueba usa el clasificador
// real de la recepción con una decisión mínima; los handlers reales llegan en los grupos 8 a 10.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StoredDocument } from "../../src/modules/fiscal/application/ports.ts";
import {
  executeSriStep,
  type SriStep,
  type StepDependencies,
  type TransmissionUnitOfWork,
} from "../../src/modules/fiscal/application/transmission-step.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { createSriEvidenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sri-evidence.ts";
import { createTransmissionUnitOfWork } from "../../src/modules/fiscal/infrastructure/transmission-unit-of-work.ts";
import type { ReceptionClassification } from "../../src/modules/sri-engine/application/classification.ts";
import type {
  BreakerOpen,
  SriExchange,
  TransportOutcome,
} from "../../src/modules/sri-engine/application/transport.ts";
import {
  RECEPTION_CLASSIFIER_VERSION,
  classifyReception,
} from "../../src/modules/sri-engine/infrastructure/reception-classifier.ts";
import { receptionEnvelope } from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { LeaseLostError, type Job } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { receptionResponse, response } from "../support/sri-responses.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, leasedJob, signedXmlOf } from "./transmission-harness.ts";

describe("evidencia antes de la clasificación", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  const logs: string[] = [];
  let calls: number;
  let reply: TransportOutcome | BreakerOpen;

  const logger = {
    info: (details: object, message: string) =>
      void logs.push(JSON.stringify({ details, message })),
    warn: (details: object, message: string) =>
      void logs.push(JSON.stringify({ details, message })),
  };

  /** Un SRI simulado que cuenta las llamadas y devuelve `reply`. */
  function gatewayCall(document: StoredDocument): Promise<SriExchange | BreakerOpen> {
    calls++;
    if ("breakerOpen" in reply) return Promise.resolve(reply);
    return Promise.resolve({
      service: "RECEPTION",
      environment: document.environment,
      endpoint: "https://sri-simulado.invalid/recepcion",
      envelope: receptionEnvelope(signedXmlOf(document.accessKey)),
      outcome: reply,
    });
  }

  /** Decisión mínima: RECIBIDA pasa a RECEIVED con el siguiente job; lo demás, a SEND_UNKNOWN. */
  const step = (
    classify: SriStep<ReceptionClassification>["classify"] = (outcome, document) => {
      const value = classifyReception(outcome, document.accessKey);
      return { value, ...value, classifierVersion: RECEPTION_CLASSIFIER_VERSION };
    },
  ): SriStep<ReceptionClassification> => ({
    operation: "RECEPTION",
    call: gatewayCall,
    sentArtifact: { sha256: "c".repeat(64), sizeBytes: 100 },
    classify,
    decide: ({ classification, document, now }) =>
      classification?.outcome === "RECEIVED"
        ? {
            transitions: [{ to: "RECEIVED", cause: "TRANSMISSION" }],
            next: {
              companyId: document.companyId,
              type: "sri.authorize",
              dedupeKey: `sri.authorize:${document.id}`,
              documentId: document.id,
              runAt: now,
              maxAttempts: 10,
            },
            job: { action: "COMPLETE" },
          }
        : {
            transitions: [{ to: "SEND_UNKNOWN", cause: "TRANSMISSION" }],
            next: {
              companyId: document.companyId,
              type: "sri.reconcile",
              dedupeKey: `sri.reconcile:${document.id}`,
              documentId: document.id,
              runAt: now,
              maxAttempts: 10,
            },
            job: { action: "COMPLETE" },
          },
  });

  /** Unidad de trabajo que se cae en sus primeras `failures` ejecuciones: una caída tras la TX A. */
  function crashingUow(failures: number): TransmissionUnitOfWork {
    const real = createTransmissionUnitOfWork(prisma);
    let remaining = failures;
    return {
      run: (work) => {
        if (remaining-- > 0)
          return Promise.reject(new Error("caída simulada entre la TX A y la TX B"));
        return real.run(work);
      },
    };
  }

  const deps = (
    uow: TransmissionUnitOfWork = createTransmissionUnitOfWork(prisma),
  ): StepDependencies => ({
    db: prisma,
    evidence: createSriEvidenceRepository(prisma),
    uow,
    jobs: store,
    logger,
    followers: [],
  });

  async function signedWithJob(owner?: string) {
    const created = await insertDocument(prisma, company, "SIGNED");
    const document = (await createDocumentRepository(prisma).find(company.companyId, created.id))!;
    const job = await leasedJob(
      store,
      prisma,
      {
        companyId: company.companyId,
        type: "sri.transmit",
        dedupeKey: `sri.transmit:${document.id}`,
        documentId: document.id,
        runAt: new Date(),
        maxAttempts: 10,
      },
      owner,
    );
    return { document, job };
  }

  const run = (
    document: StoredDocument,
    job: Job,
    options: {
      uow?: TransmissionUnitOfWork;
      signal?: AbortSignal;
      definition?: SriStep<ReceptionClassification>;
    } = {},
  ) =>
    executeSriStep(deps(options.uow), options.definition ?? step(), {
      job,
      document,
      signal: options.signal ?? new AbortController().signal,
      now: () => new Date(),
    });

  const evidenceOf = (documentId: string) =>
    prisma.sriAttempt.findMany({
      where: { documentId },
      include: { response: true, result: true },
      orderBy: { attemptNumber: "asc" },
    });
  const jobsOf = (documentId: string) =>
    prisma.job.findMany({ where: { documentId }, orderBy: { createdAt: "asc" } });
  const stateOf = async (documentId: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id: documentId } })).state;

  beforeAll(async () => {
    db = await createMigratedSchema("transmission_step");
    prisma = db.database.prisma;
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Empresa A", 1);
  });

  beforeEach(() => {
    calls = 0;
    logs.length = 0;
    reply = response(receptionResponse("RECIBIDA"));
  });

  afterAll(async () => {
    await db.drop();
  });

  it("confirma el intento y su respuesta, y después decide en una sola transacción", async () => {
    const { document, job } = await signedWithJob();
    expect(await run(document, job)).toBe("DECIDED");
    const [attempt] = await evidenceOf(document.id);
    expect(attempt).toMatchObject({
      jobId: job.id,
      transportOutcome: "RESPONSE",
      sentArtifactSha256: "c".repeat(64),
    });
    expect(attempt!.response).not.toBeNull();
    expect(attempt!.result).toMatchObject({
      outcome: "RECEIVED",
      classifierVersion: "reception/1",
    });
    expect(await stateOf(document.id)).toBe("RECEIVED");
    const transition = await prisma.documentStateTransition.findFirstOrThrow({
      where: { documentId: document.id, toState: "RECEIVED" },
    });
    expect(transition).toMatchObject({ cause: "TRANSMISSION", actorType: "SYSTEM" });
    expect(transition.metadata).toEqual({ jobId: job.id, sriAttemptId: attempt!.id });
    expect((await jobsOf(document.id)).map((row) => [row.type, row.status])).toEqual([
      ["sri.transmit", "DONE"],
      ["sri.authorize", "PENDING"],
    ]);
  });

  it("una caída entre la TX A y la TX B se clasifica al retomar, sin llamar otra vez al SRI", async () => {
    const { document, job } = await signedWithJob();
    await expect(run(document, job, { uow: crashingUow(1) })).rejects.toThrow("caída simulada");
    const [pending] = await evidenceOf(document.id);
    expect(pending!.result).toBeNull();
    expect(pending!.response).not.toBeNull();
    expect(await stateOf(document.id)).toBe("SIGNED");
    expect(calls).toBe(1);

    reply = response(
      receptionResponse("DEVUELTA", [{ messages: [{ identifier: "35", message: "x" }] }]),
    );
    expect(await run(document, job)).toBe("DECIDED");
    expect(calls).toBe(1);
    const [classified] = await evidenceOf(document.id);
    expect(classified!.id).toBe(pending!.id);
    expect(classified!.result?.outcome).toBe("RECEIVED");
    expect(await stateOf(document.id)).toBe("RECEIVED");
    expect(logs.join("\n")).toContain("sin llamar al SRI");
  });

  it("un parser que falla conserva el intento y la respuesta, y no inventa una conclusión", async () => {
    const { document, job } = await signedWithJob();
    const failing = step(() => {
      throw new Error("parser roto");
    });
    expect(await run(document, job, { definition: failing })).toBe("DECIDED");
    const [attempt] = await evidenceOf(document.id);
    expect(attempt!.response?.sizeBytes).toBeGreaterThan(0);
    expect(attempt!.result).toMatchObject({
      outcome: "UNPARSEABLE",
      messages: [],
      parsed: null,
      classifierVersion: "unparseable/1",
    });
    expect(await stateOf(document.id)).toBe("SEND_UNKNOWN");
  });

  it("un arriendo perdido entre A y B no tiene efecto: el nuevo dueño clasifica sin llamar", async () => {
    const { document, job } = await signedWithJob("worker-1");
    const stealing: TransmissionUnitOfWork = {
      run: async (work) => {
        // Otro worker retoma el job con el arriendo vencido justo antes de la TX B.
        await prisma.job.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });
        const [retaken] = await store.claim({
          owner: "worker-2",
          types: ["sri.transmit"],
          limit: 1,
          leaseMs: 60_000,
          now: new Date(),
        });
        expect(retaken?.id).toBe(job.id);
        return createTransmissionUnitOfWork(prisma).run(work);
      },
    };
    await expect(run(document, job, { uow: stealing })).rejects.toBeInstanceOf(LeaseLostError);
    const [attempt] = await evidenceOf(document.id);
    expect(attempt!.result).toBeNull();
    expect(await stateOf(document.id)).toBe("SIGNED");
    expect((await jobsOf(document.id)).map((row) => row.type)).toEqual(["sri.transmit"]);

    const retaken = (await prisma.job.findUniqueOrThrow({
      where: { id: job.id },
    })) as unknown as Job;
    expect(await run(document, retaken)).toBe("DECIDED");
    expect(calls).toBe(1);
    expect(await stateOf(document.id)).toBe("RECEIVED");
  });

  it("con el breaker abierto o con el apagado pedido no llama, no registra y no gasta el intento", async () => {
    const { document, job } = await signedWithJob();
    const retryAt = new Date(Date.now() + 60_000);
    reply = { breakerOpen: true, service: "RECEPTION", retryAt };
    expect(await run(document, job)).toBe("BREAKER_OPEN");
    expect(await evidenceOf(document.id)).toEqual([]);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: retryAt,
    });

    const [again] = await store.claim({
      owner: "worker-de-prueba",
      types: ["sri.transmit"],
      limit: 1,
      leaseMs: 60_000,
      now: new Date(retryAt.getTime() + 1),
    });
    const stopping = new AbortController();
    stopping.abort();
    calls = 0;
    expect(await run(document, again!, { signal: stopping.signal })).toBe("SHUTTING_DOWN");
    expect(calls).toBe(0);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).attemptCount).toBe(0);
  });

  it("los logs no contienen XML, SOAP ni el sobre", async () => {
    const { document, job } = await signedWithJob();
    reply = response(
      receptionResponse("DEVUELTA", [{ messages: [{ identifier: "35", message: "x" }] }]),
    );
    await run(document, job);
    const output = logs.join("\n");
    expect(output).toContain(document.accessKey);
    expect(output).not.toMatch(/<|soap|Envelope|factura|base64/i);
    expect(output).not.toContain(signedXmlOf(document.accessKey).toString("base64").slice(0, 40));
  });
});

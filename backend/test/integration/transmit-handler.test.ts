// Handler `sri.transmit` con un SRI simulado (add-sri-transmission, tareas 8.1 y 8.2, design D6,
// D9, D11, D13, D14 y D17): integridad y tamaño antes de llamar, los bytes exactos en el sobre, la
// decisión de la recepción con su traspaso atómico al siguiente job, dos workers sobre la misma
// factura, el barrido y el contador del punto intacto. Las respuestas son SINTÉTICAS con la
// estructura oficial y la política de tamaño es la SINTÉTICA del arnés.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTransmitHandler } from "../../src/modules/fiscal/application/transmit-handler.ts";
import { DocumentStateChangedError } from "../../src/modules/fiscal/application/transmission-step.ts";
import { DEFAULT_TRANSMISSION_SETTINGS } from "../../src/modules/fiscal/application/transmission-settings.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { createSriEvidenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sri-evidence.ts";
import { createTransmissionSweeper } from "../../src/modules/fiscal/infrastructure/transmission-sweeper.ts";
import { createTransmissionUnitOfWork } from "../../src/modules/fiscal/infrastructure/transmission-unit-of-work.ts";
import type {
  SriExchange,
  TransportOutcome,
} from "../../src/modules/sri-engine/application/transport.ts";
import { sriClassifiers } from "../../src/modules/sri-engine/infrastructure/index.ts";
import { receptionEnvelope } from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { LeaseLostError, type Job } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { SYNTHETIC_POLICY_BYTES } from "../support/synthetic-size-policy.ts";
import { failure, receptionResponse, response, soapFault } from "../support/sri-responses.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import {
  insertDocument,
  leasedJob,
  sha256,
  signedXmlOf,
  type TestDocument,
} from "./transmission-harness.ts";

describe("handler sri.transmit", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  const sent: Buffer[] = [];
  const replies: TransportOutcome[] = [];
  const alerts: string[] = [];
  let policy: { maxSignedDocumentBytes: number } | null;

  const handler = () =>
    createTransmitHandler({
      db: prisma,
      evidence: createSriEvidenceRepository(prisma),
      uow: createTransmissionUnitOfWork(prisma),
      jobs: store,
      logger: { info: () => {}, warn: () => {} },
      documents: createDocumentRepository(prisma),
      artifacts: createArtifactStore(prisma),
      sizePolicy: () => Promise.resolve(policy),
      gateway: {
        submit: (environment, signedXml) => {
          sent.push(signedXml);
          const outcome = replies.shift() ?? response(receptionResponse("RECIBIDA"));
          const exchange: SriExchange = {
            service: "RECEPTION",
            environment,
            endpoint: "https://sri-simulado.invalid/recepcion",
            envelope: receptionEnvelope(signedXml),
            outcome,
          };
          return Promise.resolve(exchange);
        },
      },
      classifiers: sriClassifiers,
      settings: DEFAULT_TRANSMISSION_SETTINGS,
      today: () => "2026-10-04",
      alert: (_details, message) => void alerts.push(message),
    });

  const transmitJob = (document: TestDocument, owner?: string) =>
    leasedJob(
      store,
      prisma,
      {
        companyId: company.companyId,
        type: "sri.transmit",
        dedupeKey: `sri.transmit:${document.id}`,
        documentId: document.id,
        runAt: new Date(),
        maxAttempts: 3,
      },
      owner,
    );
  const run = (job: Job) =>
    handler().run(job, { signal: new AbortController().signal, now: () => new Date() });
  const stateOf = async (id: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const jobsOf = (id: string) =>
    prisma.job.findMany({ where: { documentId: id }, orderBy: { createdAt: "asc" } });
  const transitionsOf = async (id: string) =>
    (
      await prisma.documentStateTransition.findMany({
        where: { documentId: id, cause: "TRANSMISSION" },
        orderBy: { occurredAt: "asc" },
      })
    ).map((row) => `${row.fromState}>${row.toState}`);
  const counters = () =>
    prisma.fiscalSequence.findMany({
      select: { id: true, nextNumber: true },
      orderBy: { id: "asc" },
    });

  async function signedWithJob(state = "SIGNED", options?: Parameters<typeof insertDocument>[3]) {
    const document = await insertDocument(prisma, company, state, options);
    return { document, job: await transmitJob(document) };
  }

  beforeAll(async () => {
    db = await createMigratedSchema("transmit_handler");
    prisma = db.database.prisma;
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Empresa A", 1);
  });

  beforeEach(() => {
    sent.length = 0;
    replies.length = 0;
    alerts.length = 0;
    policy = { maxSignedDocumentBytes: SYNTHETIC_POLICY_BYTES };
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("antes de llamar", () => {
    it("envía en el sobre exactamente los bytes del SIGNED_XML guardado", async () => {
      const { document, job } = await signedWithJob();
      await run(job);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.equals(signedXmlOf(document.accessKey))).toBe(true);
      const [attempt] = await prisma.sriAttempt.findMany({ where: { documentId: document.id } });
      expect(attempt).toMatchObject({
        sentArtifactSha256: sha256(signedXmlOf(document.accessKey)),
        sentArtifactSize: signedXmlOf(document.accessKey).length,
        envelopeSha256: sha256(receptionEnvelope(signedXmlOf(document.accessKey))),
      });
    });

    it("un artefacto alterado se detiene con INTEGRITY_FAILED, sin llamar ni cambiar el estado", async () => {
      const cases: [string, Parameters<typeof insertDocument>[3]][] = [
        ["XML_ACCESS_KEY", { signedXml: () => Buffer.from("<factura>sin clave</factura>") }],
        [
          "XML_ACCESS_KEY",
          {
            signedXml: (key) =>
              Buffer.from(`<claveAcceso>${key}</claveAcceso><claveAcceso>${key}</claveAcceso>`),
          },
        ],
      ];
      for (const [check, options] of cases) {
        const { document, job } = await signedWithJob("SIGNED", options);
        await run(job);
        expect(await stateOf(document.id)).toBe("SIGNED");
        expect((await jobsOf(document.id))[0]).toMatchObject({
          status: "STOPPED",
          lastErrorCode: "INTEGRITY_FAILED",
          lastErrorClass: "INTEGRITY",
          lastErrorDetail: { check },
        });
      }
      // Un hash guardado que no corresponde a los bytes.
      const { document, job } = await signedWithJob();
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${db.name}"."document_artifact" DISABLE TRIGGER USER`,
      );
      await prisma.documentArtifact.updateMany({
        where: { documentId: document.id },
        data: { sha256: "0".repeat(64) },
      });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${db.name}"."document_artifact" ENABLE TRIGGER USER`,
      );
      await run(job);
      expect((await jobsOf(document.id))[0]).toMatchObject({
        status: "STOPPED",
        lastErrorDetail: { check: "SHA256" },
      });
      expect(sent).toEqual([]);
      expect(alerts.filter((a) => a.includes("integridad"))).toHaveLength(3);
    });

    it("sobre el límite o sin política vigente, se detiene sin llamar", async () => {
      const big = await signedWithJob("SIGNED", {
        signedXml: (key) =>
          Buffer.concat([signedXmlOf(key), Buffer.alloc(SYNTHETIC_POLICY_BYTES, 0x20)]),
      });
      await run(big.job);
      expect((await jobsOf(big.document.id))[0]).toMatchObject({
        status: "STOPPED",
        lastErrorCode: "TOO_LARGE",
        lastErrorClass: "DETERMINISTIC",
      });
      policy = null;
      const missing = await signedWithJob();
      await run(missing.job);
      expect((await jobsOf(missing.document.id))[0]).toMatchObject({
        status: "STOPPED",
        lastErrorCode: "SIZE_POLICY_MISSING",
      });
      expect(sent).toEqual([]);
      expect(await stateOf(missing.document.id)).toBe("SIGNED");
    });

    it("el límite exacto de la política se envía y un byte más no", async () => {
      const base = signedXmlOf("0".repeat(49)).length;
      policy = { maxSignedDocumentBytes: base + 100 };
      const exact = await signedWithJob("SIGNED", {
        signedXml: (key) => Buffer.concat([signedXmlOf(key), Buffer.alloc(100, 0x20)]),
      });
      await run(exact.job);
      expect(sent).toHaveLength(1);
      const over = await signedWithJob("SIGNED", {
        signedXml: (key) => Buffer.concat([signedXmlOf(key), Buffer.alloc(101, 0x20)]),
      });
      await run(over.job);
      expect(sent).toHaveLength(1);
      expect((await jobsOf(over.document.id))[0]!.lastErrorCode).toBe("TOO_LARGE");
    });

    it("un envío que empezó y no dejó evidencia se reconcilia antes de reenviar", async () => {
      const { document, job } = await signedWithJob();
      // Segundo arriendo del job sin ningún intento registrado: el proceso cayó durante la llamada.
      await run({ ...job, attemptCount: 2 });
      expect(sent).toEqual([]);
      expect(await stateOf(document.id)).toBe("SEND_UNKNOWN");
      expect((await jobsOf(document.id)).map((row) => [row.type, row.status])).toEqual([
        ["sri.transmit", "DONE"],
        ["sri.reconcile", "PENDING"],
      ]);
    });
  });

  describe("decisión de la recepción con traspaso atómico", () => {
    it("RECIBIDA pasa a RECEIVED con su sri.authorize, en la misma transacción que termina el envío", async () => {
      const { document, job } = await signedWithJob();
      await run(job);
      expect(await stateOf(document.id)).toBe("RECEIVED");
      const jobs = await jobsOf(document.id);
      expect(jobs.map((row) => [row.type, row.status])).toEqual([
        ["sri.transmit", "DONE"],
        ["sri.authorize", "PENDING"],
      ]);
      expect(
        jobs[1]!.nextAttemptAt.getTime() - jobs[0]!.completedAt!.getTime(),
      ).toBeGreaterThanOrEqual(DEFAULT_TRANSMISSION_SETTINGS.poll.firstDelayMs - 50);
      expect(jobs[1]!.deadlineAt).not.toBeNull();
    });

    it("DEVUELTA pasa a RETURNED con todos sus mensajes y sin reenvío", async () => {
      const { document, job } = await signedWithJob();
      replies.push(
        response(
          receptionResponse("DEVUELTA", [
            {
              accessKey: document.accessKey,
              messages: [
                {
                  identifier: "35",
                  message: "DOCUMENTO INVÁLIDO",
                  additionalInformation: "detalle",
                },
                { identifier: "999", message: "OTRO" },
              ],
            },
          ]),
        ),
      );
      await run(job);
      expect(await stateOf(document.id)).toBe("RETURNED");
      expect((await jobsOf(document.id)).map((row) => row.type)).toEqual(["sri.transmit"]);
      const result = await prisma.sriAttemptResult.findFirstOrThrow({
        where: { attempt: { documentId: document.id } },
      });
      expect(result.outcome).toBe("RETURNED");
      expect(result.messages).toHaveLength(2);
    });

    it("sin estado, timeout, corte, HTML, Fault y vacío pasan a SEND_UNKNOWN con su reconciliación", async () => {
      for (const outcome of [
        response(receptionResponse(null)),
        failure("REQUEST_TIMEOUT"),
        failure("BODY_TIMEOUT"),
        failure("CONNECTION_LOST"),
        response("<html><body>Error</body></html>"),
        response(soapFault(), 500),
        response(""),
      ]) {
        const { document, job } = await signedWithJob();
        replies.push(outcome);
        await run(job);
        expect(await stateOf(document.id)).toBe("SEND_UNKNOWN");
        expect((await jobsOf(document.id)).map((row) => [row.type, row.status])).toEqual([
          ["sri.transmit", "DONE"],
          ["sri.reconcile", "PENDING"],
        ]);
      }
    });

    it("los errores 70, 43 y 45 nunca llevan a RETURNED; el 70 espera antes de reconciliar", async () => {
      for (const identifier of ["70", "43", "45"]) {
        const { document, job } = await signedWithJob();
        replies.push(
          response(
            receptionResponse("DEVUELTA", [
              { accessKey: document.accessKey, messages: [{ identifier, message: "x" }] },
            ]),
          ),
        );
        await run(job);
        expect(await stateOf(document.id)).toBe("SEND_UNKNOWN");
        const [, reconcile] = await jobsOf(document.id);
        expect(reconcile!.type).toBe("sri.reconcile");
        const delay = reconcile!.nextAttemptAt.getTime() - Date.now();
        if (identifier === "70")
          expect(delay).toBeGreaterThan(DEFAULT_TRANSMISSION_SETTINGS.poll.error70DelayMs - 5_000);
        else expect(delay).toBeLessThanOrEqual(0);
      }
    });

    it("una clave distinta en la respuesta va a revisión manual pasando por SEND_UNKNOWN", async () => {
      const { document, job } = await signedWithJob();
      replies.push(
        response(
          receptionResponse("DEVUELTA", [
            { accessKey: "1".repeat(49), messages: [{ identifier: "35", message: "x" }] },
          ]),
        ),
      );
      await run(job);
      expect(await stateOf(document.id)).toBe("MANUAL_REVIEW");
      expect(await transitionsOf(document.id)).toEqual([
        "SIGNED>SEND_UNKNOWN",
        "SEND_UNKNOWN>MANUAL_REVIEW",
      ]);
    });

    it("NOT_SENT no cambia el estado y reprograma; al agotar los intentos queda detenido", async () => {
      const { document, job } = await signedWithJob();
      replies.push(failure("NOT_SENT"));
      await run(job);
      expect(await stateOf(document.id)).toBe("SIGNED");
      expect((await jobsOf(document.id))[0]).toMatchObject({
        status: "PENDING",
        lastErrorCode: "SRI_UNAVAILABLE",
        attemptCount: 1,
      });
      await prisma.job.updateMany({
        where: { documentId: document.id },
        data: { nextAttemptAt: new Date(0) },
      });
      for (let attempt = 2; attempt <= 3; attempt++) {
        const [claimed] = await store.claim({
          owner: "w",
          types: ["sri.transmit"],
          limit: 1,
          leaseMs: 60_000,
          now: new Date(),
        });
        expect(claimed?.documentId).toBe(document.id);
        replies.push(failure("NOT_SENT"));
        await run(claimed!);
        await prisma.job.updateMany({
          where: { documentId: document.id, status: "PENDING" },
          data: { nextAttemptAt: new Date(0) },
        });
      }
      expect((await jobsOf(document.id))[0]).toMatchObject({
        status: "STOPPED",
        lastErrorCode: "SRI_UNAVAILABLE",
        lastErrorDetail: { exhaustedLimit: "ATTEMPTS", transport: "ECONNREFUSED" },
      });
      expect(await stateOf(document.id)).toBe("SIGNED");
    });

    it("un reenvío desde SEND_UNKNOWN usa el mismo procedimiento y los mismos bytes", async () => {
      const { document, job } = await signedWithJob("SEND_UNKNOWN");
      await run(job);
      expect(sent[0]!.equals(signedXmlOf(document.accessKey))).toBe(true);
      expect(await stateOf(document.id)).toBe("RECEIVED");
      expect(await transitionsOf(document.id)).toEqual(["SEND_UNKNOWN>RECEIVED"]);
    });

    it("dos workers que intentan avanzar la misma factura: solo uno confirma y nadie reenvía", async () => {
      const document = await insertDocument(prisma, company, "SIGNED");
      const first = await transmitJob(document, "worker-1");
      await prisma.job.update({ where: { id: first.id }, data: { leaseExpiresAt: new Date(0) } });
      const [second] = await store.claim({
        owner: "worker-2",
        types: ["sri.transmit"],
        limit: 1,
        leaseMs: 60_000,
        now: new Date(),
      });
      expect(second?.id).toBe(first.id);
      const results = await Promise.allSettled([run(first), run(second!)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      // Lo revierte la guarda del arriendo o la transición guardada, la que llegue primero.
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(
        rejected.reason instanceof LeaseLostError ||
          rejected.reason instanceof DocumentStateChangedError,
      ).toBe(true);
      // Solo el primer worker llamó. El segundo nunca reenvía: si encuentra la respuesta guardada
      // la clasifica, y si no encuentra evidencia de un arriendo anterior que pudo enviar, pasa a
      // SEND_UNKNOWN para reconciliar (design D8).
      expect(sent).toHaveLength(1);
      const transitions = await transitionsOf(document.id);
      const successors = (await jobsOf(document.id)).slice(1).map((row) => row.type);
      if ((await stateOf(document.id)) === "RECEIVED") {
        expect(transitions).toEqual(["SIGNED>RECEIVED"]);
        expect(successors).toEqual(["sri.authorize"]);
      } else {
        expect(await stateOf(document.id)).toBe("SEND_UNKNOWN");
        expect(transitions).toEqual(["SIGNED>SEND_UNKNOWN"]);
        expect(successors).toEqual(["sri.reconcile"]);
      }
    });

    it("ningún caso cambia el contador del punto de emisión", async () => {
      const before = await counters();
      const { job } = await signedWithJob();
      replies.push(
        response(
          receptionResponse("DEVUELTA", [{ messages: [{ identifier: "45", message: "x" }] }]),
        ),
      );
      await run(job);
      const after = await counters();
      // insertDocument reserva un número; la transmisión no reserva ninguno más.
      expect(after.reduce((sum, row) => sum + row.nextNumber, 0)).toBe(
        before.reduce((sum, row) => sum + row.nextNumber, 0) + 1,
      );
    });
  });

  describe("barrido idempotente", () => {
    it("crea exactamente un sri.transmit por cada SIGNED sin job y no reactiva los detenidos", async () => {
      const prismaJobs = () =>
        prisma.job.count({ where: { type: "sri.transmit", status: "PENDING" } });
      const lonely = [
        await insertDocument(prisma, company, "SIGNED"),
        await insertDocument(prisma, company, "SIGNED"),
      ];
      const stopped = await signedWithJob();
      await store.stop(
        prisma,
        stopped.job,
        { code: "SRI_UNAVAILABLE", errorClass: "RETRYABLE" },
        new Date(),
      );
      const received = await insertDocument(prisma, company, "RECEIVED");
      const sweeper = createTransmissionSweeper({
        prisma,
        jobs: store,
        settings: DEFAULT_TRANSMISSION_SETTINGS,
        logger: { info: () => {}, error: () => {} },
      });
      const before = await prismaJobs();
      const created = await sweeper.sweep();
      expect(created).toBe(2);
      expect(await sweeper.sweep()).toBe(0);
      expect(await sweeper.sweep()).toBe(0);
      for (const document of lonely) {
        expect((await jobsOf(document.id)).map((row) => [row.type, row.status])).toEqual([
          ["sri.transmit", "PENDING"],
        ]);
      }
      expect((await jobsOf(stopped.document.id)).map((row) => row.status)).toEqual(["STOPPED"]);
      expect(await jobsOf(received.id)).toEqual([]);
      expect(await prismaJobs()).toBe(before + created);
    });
  });
});

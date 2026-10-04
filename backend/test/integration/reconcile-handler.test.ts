// Reconciliación por clave con un SRI simulado (add-sri-transmission, tarea 10.1, design D4, D12,
// D13 y D15): casos A, B y E de CTX §52, el error 45 con esta clave y con otra, la guarda de validez,
// el reenvío de los mismos bytes, ningún número nuevo y ningún proceso automático sobre una revisión
// manual. Respuestas SINTÉTICAS con la estructura oficial.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createReconcileHandler } from "../../src/modules/fiscal/application/reconcile-handler.ts";
import { createTransmitHandler } from "../../src/modules/fiscal/application/transmit-handler.ts";
import { DEFAULT_TRANSMISSION_SETTINGS } from "../../src/modules/fiscal/application/transmission-settings.ts";
import type { TransmissionUnitOfWork } from "../../src/modules/fiscal/application/transmission-step.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { createSriEvidenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sri-evidence.ts";
import { createTransmissionUnitOfWork } from "../../src/modules/fiscal/infrastructure/transmission-unit-of-work.ts";
import type {
  SriExchange,
  SriService,
  TransportOutcome,
} from "../../src/modules/sri-engine/application/transport.ts";
import { sriClassifiers } from "../../src/modules/sri-engine/infrastructure/index.ts";
import {
  authorizationEnvelope,
  receptionEnvelope,
  validityEnvelope,
} from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { Job, NewJob } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { SYNTHETIC_POLICY_BYTES } from "../support/synthetic-size-policy.ts";
import {
  authorizationResponse,
  failure,
  receptionResponse,
  response,
  validityResponse,
} from "../support/sri-responses.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import {
  insertDocument,
  leasedJob,
  signedXmlOf,
  type TestDocument,
} from "./transmission-harness.ts";

type Reply = { service: SriService; outcome: TransportOutcome };

describe("reconciliación por clave", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  let calls: { service: SriService; envelope: Buffer }[];
  const replies: Reply[] = [];

  function exchange(service: SriService, environment: "TEST" | "PRODUCTION", envelope: Buffer) {
    calls.push({ service, envelope });
    const index = replies.findIndex((reply) => reply.service === service);
    const outcome = index >= 0 ? replies.splice(index, 1)[0]!.outcome : failure("CONNECTION_LOST");
    const result: SriExchange = {
      service,
      environment,
      endpoint: `simulado:${service}`,
      envelope,
      outcome,
    };
    return Promise.resolve(result);
  }
  const gateway = {
    submit: (environment: "TEST" | "PRODUCTION", xml: Buffer) =>
      exchange("RECEPTION", environment, receptionEnvelope(xml)),
    queryAuthorization: (environment: "TEST" | "PRODUCTION", key: string) =>
      exchange("AUTHORIZATION", environment, authorizationEnvelope(key)),
    queryValidity: (environment: "TEST" | "PRODUCTION", key: string) =>
      exchange("VALIDITY", environment, validityEnvelope(key)),
  };
  const base = (uow: TransmissionUnitOfWork = createTransmissionUnitOfWork(prisma)) => ({
    db: prisma,
    evidence: createSriEvidenceRepository(prisma),
    uow,
    jobs: store,
    logger: { info: () => {}, warn: () => {} },
    documents: createDocumentRepository(prisma),
    classifiers: sriClassifiers,
    settings: DEFAULT_TRANSMISSION_SETTINGS,
  });
  const reconcile = (uow?: TransmissionUnitOfWork) =>
    createReconcileHandler({ ...base(uow), inquiry: gateway, random: () => 0.5 }).handler;
  const transmit = () =>
    createTransmitHandler({
      ...base(),
      artifacts: createArtifactStore(prisma),
      sizePolicy: () => Promise.resolve({ maxSignedDocumentBytes: SYNTHETIC_POLICY_BYTES }),
      gateway,
      today: () => "2026-10-04",
      alert: () => {},
    });
  const context = () => ({ signal: new AbortController().signal, now: () => new Date() });

  const jobFor = (
    document: TestDocument,
    type: string,
    overrides: Partial<NewJob> = {},
  ): Promise<Job> =>
    leasedJob(store, prisma, {
      companyId: company.companyId,
      type,
      dedupeKey: `${type}:${document.id}`,
      documentId: document.id,
      runAt: new Date(),
      maxAttempts: 1_000,
      deadlineAt: new Date(Date.now() + 24 * 3_600_000),
      ...overrides,
    });

  /** Evidencia previa de recepción del comprobante, como la dejaría el envío. */
  async function receptionEvidence(document: TestDocument, outcome: string) {
    const attempt = await prisma.sriAttempt.create({
      data: {
        companyId: company.companyId,
        documentId: document.id,
        attemptNumber: (await prisma.sriAttempt.count({ where: { documentId: document.id } })) + 1,
        operation: "RECEPTION",
        environment: "TEST",
        endpoint: "simulado:RECEPTION",
        origin: "AUTOMATIC",
        startedAt: new Date(),
        completedAt: new Date(),
        transportOutcome: "RESPONSE",
        httpStatus: 200,
        envelopeSha256: "a".repeat(64),
        envelopeSize: 10,
      },
    });
    await prisma.sriAttemptResult.create({
      data: {
        attemptId: attempt.id,
        companyId: company.companyId,
        outcome,
        messages: [],
        classifierVersion: "reception/1",
      },
    });
  }

  const authorizedReply = (document: TestDocument) => ({
    service: "AUTHORIZATION" as const,
    outcome: response(
      authorizationResponse(document.accessKey, [
        {
          estado: "AUTORIZADO",
          numeroAutorizacion: document.accessKey,
          fechaAutorizacion: "2026-10-04T10:15:30-05:00",
          ambiente: "PRUEBAS",
        },
      ]),
    ),
  });
  const keyUnknown = (document: TestDocument) => ({
    service: "AUTHORIZATION" as const,
    outcome: response(authorizationResponse(document.accessKey, [], "0")),
  });
  const validityNoData = (document: TestDocument) => ({
    service: "VALIDITY" as const,
    outcome: response(
      validityResponse({
        accessKey: document.accessKey,
        estadoConsulta: "RECHAZADA",
        messages: [{ identifier: "99", message: "ERROR AL CONSULTAR DATOS DEL SERVICIO WEB" }],
      }),
    ),
  });
  const stateOf = async (id: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const jobsOf = (id: string) =>
    prisma.job.findMany({ where: { documentId: id }, orderBy: { createdAt: "asc" } });
  const counters = async () =>
    (await prisma.fiscalSequence.findMany({ select: { nextNumber: true } })).reduce(
      (sum, row) => sum + row.nextNumber,
      0,
    );

  beforeAll(async () => {
    db = await createMigratedSchema("reconcile_handler");
    prisma = db.database.prisma;
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Empresa A", 1);
  });

  beforeEach(() => {
    calls = [];
    replies.length = 0;
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("caso A: timeout al enviar", () => {
    it("si la clave existe autorizada, concluye sin reenviar", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      replies.push(authorizedReply(document));
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(await stateOf(document.id)).toBe("AUTHORIZED");
      expect(calls.map((call) => call.service)).toEqual(["AUTHORIZATION"]);
      expect((await jobsOf(document.id)).map((row) => [row.type, row.status])).toEqual([
        ["sri.reconcile", "DONE"],
      ]);
    });

    it("si la clave no existe y la validez no aporta evidencia, reenvía los mismos bytes", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      replies.push(keyUnknown(document), validityNoData(document));
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(calls.map((call) => call.service)).toEqual(["AUTHORIZATION", "VALIDITY"]);
      expect(await stateOf(document.id)).toBe("SEND_UNKNOWN");
      const jobs = await jobsOf(document.id);
      expect(jobs.map((row) => [row.type, row.status])).toEqual([
        ["sri.reconcile", "DONE"],
        ["sri.transmit", "PENDING"],
      ]);
      // El reenvío envía exactamente el SIGNED_XML guardado.
      const resend = await prisma.job.update({
        where: { id: jobs[1]!.id },
        data: {
          status: "LEASED",
          leaseOwner: "w",
          leaseExpiresAt: new Date(Date.now() + 60_000),
          attemptCount: 1,
        },
      });
      replies.push({ service: "RECEPTION", outcome: response(receptionResponse("RECIBIDA")) });
      await transmit().run(resend as unknown as Job, context());
      const sent = calls.find((call) => call.service === "RECEPTION")!;
      expect(sent.envelope.equals(receptionEnvelope(signedXmlOf(document.accessKey)))).toBe(true);
      expect(await stateOf(document.id)).toBe("RECEIVED");
    });

    it("si la validez conoce la clave, no reenvía: recibido y consulta de autorización", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      replies.push(keyUnknown(document), {
        service: "VALIDITY",
        outcome: response(
          validityResponse({ accessKey: document.accessKey, estadoAutorizacion: "AUTORIZADO" }),
        ),
      });
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(await stateOf(document.id)).toBe("RECEIVED");
      expect((await jobsOf(document.id)).map((row) => row.type)).toEqual([
        "sri.reconcile",
        "sri.authorize",
      ]);
    });

    it("una anulación informada por la validez va a revisión manual", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      replies.push(keyUnknown(document), {
        service: "VALIDITY",
        outcome: response(
          validityResponse({ accessKey: document.accessKey, estadoAutorizacion: "ANULADO" }),
        ),
      });
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(await stateOf(document.id)).toBe("MANUAL_REVIEW");
      expect((await jobsOf(document.id)).map((row) => [row.type, row.status])).toEqual([
        ["sri.reconcile", "DONE"],
      ]);
    });

    it("NO AUTORIZADO informado por la validez no reenvía; PENDIENTE DE ANULAR va a revisión manual", async () => {
      for (const [estado, state, jobs] of [
        ["NO AUTORIZADO", "RECEIVED", ["sri.reconcile", "sri.authorize"]],
        ["PENDIENTE DE ANULAR", "MANUAL_REVIEW", ["sri.reconcile"]],
      ] as const) {
        const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
        replies.push(keyUnknown(document), {
          service: "VALIDITY",
          outcome: response(
            validityResponse({ accessKey: document.accessKey, estadoAutorizacion: estado }),
          ),
        });
        await reconcile().run(await jobFor(document, "sri.reconcile"), context());
        expect(await stateOf(document.id), estado).toBe(state);
        expect(
          (await jobsOf(document.id)).map((row) => row.type),
          estado,
        ).toEqual([...jobs]);
      }
    });

    it("una validez que responde por otra clave es inconsistente: revisión manual, sin reenvío", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      const other = `${document.accessKey.slice(0, 40)}${document.accessKey[40] === "9" ? "0" : "9"}${document.accessKey.slice(41)}`;
      replies.push(keyUnknown(document), {
        service: "VALIDITY",
        outcome: response(validityResponse({ accessKey: other, estadoAutorizacion: "AUTORIZADO" })),
      });
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(await stateOf(document.id)).toBe("MANUAL_REVIEW");
      expect(calls.map((call) => call.service)).toEqual(["AUTHORIZATION", "VALIDITY"]);
      expect((await jobsOf(document.id)).map((row) => [row.type, row.status])).toEqual([
        ["sri.reconcile", "DONE"],
      ]);
      const results = await prisma.sriAttemptResult.findMany({
        where: { attempt: { documentId: document.id, operation: "VALIDITY" } },
      });
      expect(results.map((row) => [row.outcome, row.classifierVersion])).toEqual([
        ["INCONSISTENT", "validity/2"],
      ]);
    });
  });

  describe("caso B y caso E: evidencia de recepción", () => {
    it("error 70: si la clave aparece autorizada, concluye sin reenviar", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      await receptionEvidence(document, "KEY_IN_PROCESS");
      replies.push(authorizedReply(document));
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(await stateOf(document.id)).toBe("AUTHORIZED");
      expect(calls.map((call) => call.service)).toEqual(["AUTHORIZATION"]);
      expect((await jobsOf(document.id)).map((row) => row.type)).toEqual(["sri.reconcile"]);
    });

    it("error 70: con la clave desconocida no reenvía y vuelve a consultar dentro de la ventana", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      await receptionEvidence(document, "KEY_IN_PROCESS");
      replies.push(keyUnknown(document), validityNoData(document));
      const job = await jobFor(document, "sri.reconcile");
      await reconcile().run(job, context());
      expect(await stateOf(document.id)).toBe("SEND_UNKNOWN");
      expect((await jobsOf(document.id)).map((row) => [row.type, row.status])).toEqual([
        ["sri.reconcile", "PENDING"],
      ]);
      expect(calls.filter((call) => call.service === "RECEPTION")).toEqual([]);
    });

    it("con evidencia de recepción y la ventana agotada, revisión manual", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      await receptionEvidence(document, "KEY_IN_PROCESS");
      replies.push(keyUnknown(document), validityNoData(document));
      await reconcile().run(
        await jobFor(document, "sri.reconcile", { deadlineAt: new Date(Date.now() - 1) }),
        context(),
      );
      expect(await stateOf(document.id)).toBe("MANUAL_REVIEW");
    });

    it("error 43: la clave conocida decide su estado", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      await receptionEvidence(document, "KEY_REGISTERED");
      replies.push({
        service: "AUTHORIZATION",
        outcome: response(
          authorizationResponse(document.accessKey, [
            {
              estado: "NO AUTORIZADO",
              ambiente: "PRUEBAS",
              messages: [{ identifier: "46", message: "x" }],
            },
          ]),
        ),
      });
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(await stateOf(document.id)).toBe("NOT_AUTHORIZED");
    });

    it("una autorización en procesamiento lleva a recibido y a la consulta periódica", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      replies.push({
        service: "AUTHORIZATION",
        outcome: response(
          authorizationResponse(document.accessKey, [
            { estado: "EN PROCESO", ambiente: "PRUEBAS" },
          ]),
        ),
      });
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(await stateOf(document.id)).toBe("RECEIVED");
      expect((await jobsOf(document.id)).map((row) => row.type)).toEqual([
        "sri.reconcile",
        "sri.authorize",
      ]);
    });
  });

  describe("error 45", () => {
    it("con esta clave, su estado manda", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      await receptionEvidence(document, "SEQUENTIAL_REGISTERED");
      replies.push(authorizedReply(document));
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(await stateOf(document.id)).toBe("AUTHORIZED");
    });

    it("con otra clave (la autorización no conoce esta), revisión manual sin reenvío", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      await receptionEvidence(document, "SEQUENTIAL_REGISTERED");
      replies.push(keyUnknown(document), validityNoData(document));
      const before = await counters();
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(await stateOf(document.id)).toBe("MANUAL_REVIEW");
      expect((await jobsOf(document.id)).map((row) => row.type)).toEqual(["sri.reconcile"]);
      expect(await counters()).toBe(before);
    });
  });

  describe("revisión manual y fallos técnicos", () => {
    it("ningún proceso automático cambia una revisión manual", async () => {
      const document = await insertDocument(prisma, company, "MANUAL_REVIEW");
      replies.push(authorizedReply(document));
      await reconcile().run(await jobFor(document, "sri.reconcile"), context());
      expect(calls).toEqual([]);
      expect(await stateOf(document.id)).toBe("MANUAL_REVIEW");
    });

    it("una reconciliación manual desde revisión manual con la clave desconocida no reenvía y permanece", async () => {
      const document = await insertDocument(prisma, company, "MANUAL_REVIEW");
      replies.push(keyUnknown(document), validityNoData(document));
      const job = await jobFor(document, "sri.reconcile", {
        origin: "MANUAL",
        requestedBy: company.adminId,
        reason: "revisión",
        payload: { correlationId: "req-1" },
      });
      await reconcile().run(job, context());
      expect(await stateOf(document.id)).toBe("MANUAL_REVIEW");
      expect((await jobsOf(document.id)).map((row) => [row.type, row.status])).toEqual([
        ["sri.reconcile", "DONE"],
      ]);
      const [event] = await prisma.auditEvent.findMany({
        where: { companyId: company.companyId, action: "invoice.reconciliation_completed" },
      });
      expect(event).toMatchObject({
        actorUserId: company.adminId,
        correlationId: "req-1",
        changes: { invoiceId: document.id, result: "KEY_UNKNOWN", state: "MANUAL_REVIEW" },
      });
    });

    it("una reconciliación manual desde revisión manual que encuentra la autorización concluye", async () => {
      const document = await insertDocument(prisma, company, "MANUAL_REVIEW");
      replies.push(authorizedReply(document));
      const job = await jobFor(document, "sri.reconcile", {
        origin: "MANUAL",
        requestedBy: company.adminId,
        reason: "x",
      });
      await reconcile().run(job, context());
      expect(await stateOf(document.id)).toBe("AUTHORIZED");
      const transition = await prisma.documentStateTransition.findFirstOrThrow({
        where: { documentId: document.id, toState: "AUTHORIZED" },
      });
      expect(transition).toMatchObject({
        cause: "RECONCILIATION",
        actorType: "USER",
        actorUserId: company.adminId,
      });
    });

    it("un fallo técnico reintenta; al agotar la ventana el job se detiene sin cambiar el estado", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      replies.push({ service: "AUTHORIZATION", outcome: failure("REQUEST_TIMEOUT") });
      const job = await jobFor(document, "sri.reconcile", { deadlineAt: new Date(Date.now() + 1) });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await reconcile().run(job, context());
      expect(await stateOf(document.id)).toBe("SEND_UNKNOWN");
      expect((await jobsOf(document.id))[0]).toMatchObject({
        status: "STOPPED",
        lastErrorCode: "SRI_UNAVAILABLE",
      });
    });

    it("una caída en la consulta de validez se retoma en ella, sin repetir la autorización", async () => {
      const document = await insertDocument(prisma, company, "SEND_UNKNOWN");
      replies.push(keyUnknown(document), validityNoData(document));
      const real = createTransmissionUnitOfWork(prisma);
      let runs = 0;
      const crashOnSecond: TransmissionUnitOfWork = {
        run: (work) =>
          ++runs === 2 ? Promise.reject(new Error("caída simulada")) : real.run(work),
      };
      const job = await jobFor(document, "sri.reconcile");
      await expect(reconcile(crashOnSecond).run(job, context())).rejects.toThrow("caída simulada");
      await reconcile().run(job, context());
      expect(calls.map((call) => call.service)).toEqual(["AUTHORIZATION", "VALIDITY"]);
      expect((await jobsOf(document.id)).map((row) => row.type)).toEqual([
        "sri.reconcile",
        "sri.transmit",
      ]);
    });
  });
});

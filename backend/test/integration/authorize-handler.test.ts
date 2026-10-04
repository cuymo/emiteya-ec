// Handler `sri.authorize` con un SRI simulado (add-sri-transmission, tarea 9.1, design D4, D12 y
// D16): autorización con sus dos artefactos, sin XML, no autorizado terminal, estado desconocido,
// ambiente y número distintos, varias autorizaciones, ventana agotada, SRI caído y los casos C y D
// de CTX §52. Respuestas SINTÉTICAS con la estructura oficial.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuthorizeHandler } from "../../src/modules/fiscal/application/authorize-handler.ts";
import { createTransmitHandler } from "../../src/modules/fiscal/application/transmit-handler.ts";
import { DEFAULT_TRANSMISSION_SETTINGS } from "../../src/modules/fiscal/application/transmission-settings.ts";
import type { TransmissionUnitOfWork } from "../../src/modules/fiscal/application/transmission-step.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { createSriEvidenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sri-evidence.ts";
import { createTransmissionUnitOfWork } from "../../src/modules/fiscal/infrastructure/transmission-unit-of-work.ts";
import type {
  SriExchange,
  TransportOutcome,
} from "../../src/modules/sri-engine/application/transport.ts";
import { sriClassifiers } from "../../src/modules/sri-engine/infrastructure/index.ts";
import {
  authorizationEnvelope,
  receptionEnvelope,
} from "../../src/modules/sri-engine/infrastructure/soap-envelopes.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { Job } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { SYNTHETIC_POLICY_BYTES } from "../support/synthetic-size-policy.ts";
import {
  authorizationResponse,
  failure,
  receptionResponse,
  response,
  type SyntheticAuthorization,
} from "../support/sri-responses.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import {
  insertDocument,
  leasedJob,
  sha256,
  signedXmlOf,
  type TestDocument,
} from "./transmission-harness.ts";

describe("handler sri.authorize", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  let calls: string[];
  const replies: TransportOutcome[] = [];

  function gateway() {
    const exchange = (
      service: "RECEPTION" | "AUTHORIZATION",
      environment: "TEST" | "PRODUCTION",
      envelope: Buffer,
    ) => {
      calls.push(service);
      const outcome = replies.shift() ?? failure("CONNECTION_LOST");
      const result: SriExchange = {
        service,
        environment,
        endpoint: `simulado:${service}`,
        envelope,
        outcome,
      };
      return Promise.resolve(result);
    };
    return {
      submit: (environment: "TEST" | "PRODUCTION", xml: Buffer) =>
        exchange("RECEPTION", environment, receptionEnvelope(xml)),
      queryAuthorization: (environment: "TEST" | "PRODUCTION", key: string) =>
        exchange("AUTHORIZATION", environment, authorizationEnvelope(key)),
    };
  }
  const base = (uow: TransmissionUnitOfWork = createTransmissionUnitOfWork(prisma)) => ({
    db: prisma,
    evidence: createSriEvidenceRepository(prisma),
    uow,
    jobs: store,
    logger: { info: () => {}, warn: () => {} },
    documents: createDocumentRepository(prisma),
    gateway: gateway(),
    classifiers: sriClassifiers,
    settings: DEFAULT_TRANSMISSION_SETTINGS,
  });
  const authorize = (uow?: TransmissionUnitOfWork) =>
    createAuthorizeHandler({ ...base(uow), random: () => 0.5 });
  const transmit = (uow?: TransmissionUnitOfWork) =>
    createTransmitHandler({
      ...base(uow),
      artifacts: createArtifactStore(prisma),
      sizePolicy: () => Promise.resolve({ maxSignedDocumentBytes: SYNTHETIC_POLICY_BYTES }),
      today: () => "2026-10-04",
      alert: () => {},
    });
  const context = () => ({ signal: new AbortController().signal, now: () => new Date() });
  const crashOnce = (): TransmissionUnitOfWork => {
    const real = createTransmissionUnitOfWork(prisma);
    let crashed = false;
    return {
      run: (work) => {
        if (!crashed) {
          crashed = true;
          return Promise.reject(new Error("caída simulada antes de guardar"));
        }
        return real.run(work);
      },
    };
  };

  async function receivedWithJob(
    options: { deadlineAt?: Date; environment?: "TEST" | "PRODUCTION" } = {},
  ) {
    const document = await insertDocument(
      prisma,
      company,
      "RECEIVED",
      options.environment ? { environment: options.environment } : {},
    );
    const job = await leasedJob(store, prisma, {
      companyId: company.companyId,
      type: "sri.authorize",
      dedupeKey: `sri.authorize:${document.id}`,
      documentId: document.id,
      runAt: new Date(),
      maxAttempts: 1_000,
      deadlineAt: options.deadlineAt ?? new Date(Date.now() + 24 * 3_600_000),
    });
    return { document, job };
  }
  const authorized = (
    document: TestDocument,
    overrides: Partial<SyntheticAuthorization> = {},
  ): SyntheticAuthorization => ({
    estado: "AUTORIZADO",
    numeroAutorizacion: document.accessKey,
    fechaAutorizacion: "2026-10-04T10:15:30-05:00",
    ambiente: "PRUEBAS",
    comprobante: `<![CDATA[${signedXmlOf(document.accessKey).toString("utf8")}]]>`,
    messages: [{ identifier: "60", message: "AMBIENTE DE PRUEBAS", type: "ADVERTENCIA" }],
    ...overrides,
  });
  const reply = (document: TestDocument, authorizations: SyntheticAuthorization[]) =>
    replies.push(response(authorizationResponse(document.accessKey, authorizations)));
  const documentOf = (id: string) => prisma.electronicDocument.findUniqueOrThrow({ where: { id } });
  const jobOf = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    db = await createMigratedSchema("authorize_handler");
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

  it("una autorización válida guarda el número, la fecha, el ambiente y el XML autorizado aparte", async () => {
    const { document, job } = await receivedWithJob();
    reply(document, [authorized(document)]);
    await authorize().run(job, context());
    expect(await documentOf(document.id)).toMatchObject({
      state: "AUTHORIZED",
      authorizationNumber: document.accessKey,
      authorizationDate: new Date("2026-10-04T15:15:30Z"),
      authorizationEnvironment: "TEST",
    });
    const artifacts = await prisma.documentArtifact.findMany({
      where: { documentId: document.id },
      orderBy: { kind: "asc" },
    });
    expect(artifacts.map((row) => row.kind)).toEqual(["AUTHORIZED_XML", "SIGNED_XML"]);
    const [authorizedXml, signedXml] = artifacts;
    expect(Buffer.from(authorizedXml!.content).equals(signedXmlOf(document.accessKey))).toBe(true);
    expect(authorizedXml!.sha256).toBe(sha256(Buffer.from(authorizedXml!.content)));
    expect([authorizedXml!.mediaType, authorizedXml!.sizeBytes]).toEqual([
      "application/xml",
      Buffer.from(authorizedXml!.content).length,
    ]);
    // El SIGNED_XML no cambia: sigue siendo lo enviado, con su hash.
    expect(Buffer.from(signedXml!.content).equals(signedXmlOf(document.accessKey))).toBe(true);
    expect(signedXml!.sha256).toBe(sha256(signedXmlOf(document.accessKey)));
    expect(authorizedXml!.metadata).toMatchObject({
      authorizationNumber: document.accessKey,
      authorizationDate: "2026-10-04T10:15:30-05:00",
    });
    expect(signedXml!.id).not.toBe(authorizedXml!.id);
    expect((await jobOf(job.id)).status).toBe("DONE");
    expect(calls).toEqual(["AUTHORIZATION"]);
  });

  it("una autorización sin XML es válida y no crea artefacto", async () => {
    const { document, job } = await receivedWithJob();
    reply(document, [authorized(document, { comprobante: undefined })]);
    await authorize().run(job, context());
    expect((await documentOf(document.id)).state).toBe("AUTHORIZED");
    expect(
      await prisma.documentArtifact.count({
        where: { documentId: document.id, kind: "AUTHORIZED_XML" },
      }),
    ).toBe(0);
  });

  it("no autorizado (también RECHAZADO) es terminal, con sus mensajes y sin reintento", async () => {
    for (const estado of ["NO AUTORIZADO", "RECHAZADO"]) {
      const { document, job } = await receivedWithJob();
      reply(document, [
        { estado, ambiente: "PRUEBAS", messages: [{ identifier: "46", message: "RUC no existe" }] },
      ]);
      await authorize().run(job, context());
      expect((await documentOf(document.id)).state).toBe("NOT_AUTHORIZED");
      expect((await jobOf(job.id)).status).toBe("DONE");
      const result = await prisma.sriAttemptResult.findFirstOrThrow({
        where: { attempt: { documentId: document.id } },
      });
      expect(result).toMatchObject({
        outcome: "NOT_AUTHORIZED",
        messages: [expect.objectContaining({ identifier: "46" })],
      });
      expect(await prisma.job.count({ where: { documentId: document.id } })).toBe(1);
      expect(await documentOf(document.id)).toMatchObject({
        documentNumber: document.documentNumber,
        accessKey: document.accessKey,
      });
    }
  });

  it("un AUTORIZADO sin fecha o sin número va a revisión manual", async () => {
    for (const overrides of [{ fechaAutorizacion: undefined }, { numeroAutorizacion: undefined }]) {
      const { document, job } = await receivedWithJob();
      reply(document, [authorized(document, overrides)]);
      await authorize().run(job, context());
      expect(await documentOf(document.id)).toMatchObject({
        state: "MANUAL_REVIEW",
        authorizationNumber: null,
      });
    }
  });

  it("un fallo de transporte dentro de la ventana reintenta con espera, sin cambiar el estado", async () => {
    const { document, job } = await receivedWithJob();
    replies.push(failure("CONNECTION_LOST"));
    await authorize().run(job, context());
    expect((await documentOf(document.id)).state).toBe("RECEIVED");
    const after = await jobOf(job.id);
    expect(after).toMatchObject({ status: "PENDING", lastErrorCode: "SRI_UNAVAILABLE" });
    expect(after.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("un estado desconocido no concluye: sigue recibido y vuelve a consultar dentro de la ventana", async () => {
    const { document, job } = await receivedWithJob();
    reply(document, [{ estado: "EN PROCESO", ambiente: "PRUEBAS" }]);
    await authorize().run(job, context());
    expect((await documentOf(document.id)).state).toBe("RECEIVED");
    const after = await jobOf(job.id);
    expect(after).toMatchObject({ status: "PENDING", attemptCount: 1, lastErrorCode: null });
    expect(after.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("un ambiente distinto o un número distinto de la clave van a revisión manual", async () => {
    for (const overrides of [{ ambiente: "PRODUCCION" }, { numeroAutorizacion: "1".repeat(49) }]) {
      const { document, job } = await receivedWithJob();
      reply(document, [authorized(document, overrides)]);
      await authorize().run(job, context());
      expect((await documentOf(document.id)).state).toBe("MANUAL_REVIEW");
      expect((await documentOf(document.id)).authorizationNumber).toBeNull();
    }
  });

  it("varias autorizaciones: una sola AUTORIZADO válida concluye; dos AUTORIZADO, revisión manual", async () => {
    const one = await receivedWithJob();
    reply(one.document, [{ estado: "RECHAZADO", ambiente: "PRUEBAS" }, authorized(one.document)]);
    await authorize().run(one.job, context());
    expect((await documentOf(one.document.id)).state).toBe("AUTHORIZED");
    // Todas quedan en la evidencia: la respuesta original y el resultado con las dos.
    const [evidence] = await prisma.sriAttempt.findMany({
      where: { documentId: one.document.id },
      include: { response: true, result: true },
    });
    expect(
      Buffer.from(evidence!.response!.body).toString("utf8").split("<autorizacion>"),
    ).toHaveLength(3);
    expect(evidence!.result!.parsed).toMatchObject({ autorizaciones: 2 });
    const two = await receivedWithJob();
    reply(two.document, [authorized(two.document), authorized(two.document)]);
    await authorize().run(two.job, context());
    expect((await documentOf(two.document.id)).state).toBe("MANUAL_REVIEW");
  });

  it("agotada la ventana con respuestas sin conclusión, revisión manual", async () => {
    const { document, job } = await receivedWithJob({ deadlineAt: new Date(Date.now() - 1_000) });
    reply(document, [{ estado: "EN PROCESO", ambiente: "PRUEBAS" }]);
    await authorize().run(job, context());
    expect((await documentOf(document.id)).state).toBe("MANUAL_REVIEW");
    expect((await jobOf(job.id)).status).toBe("DONE");
  });

  it("un SRI caído no lleva a revisión manual: al agotar la ventana el job se detiene", async () => {
    const { document, job } = await receivedWithJob({ deadlineAt: new Date(Date.now() + 2_000) });
    replies.push(failure("CONNECTION_LOST"));
    await authorize().run(job, context());
    expect((await documentOf(document.id)).state).toBe("RECEIVED");
    expect(await jobOf(job.id)).toMatchObject({
      status: "STOPPED",
      lastErrorCode: "SRI_UNAVAILABLE",
      lastErrorDetail: { exhaustedLimit: "DEADLINE", reason: "CONNECTION_LOST" },
    });
  });

  it("caso C: tras una caída después de RECIBIDA, el reinicio continúa con la autorización", async () => {
    const document = await insertDocument(prisma, company, "SIGNED");
    const transmitJob = await leasedJob(store, prisma, {
      companyId: company.companyId,
      type: "sri.transmit",
      dedupeKey: `sri.transmit:${document.id}`,
      documentId: document.id,
      runAt: new Date(),
      maxAttempts: 3,
    });
    replies.push(response(receptionResponse("RECIBIDA")));
    await expect(transmit(crashOnce()).run(transmitJob, context())).rejects.toThrow(
      "caída simulada",
    );
    expect((await documentOf(document.id)).state).toBe("SIGNED");
    // Reinicio: el job se retoma y clasifica la recepción guardada sin volver a enviar.
    await transmit().run(transmitJob, context());
    expect((await documentOf(document.id)).state).toBe("RECEIVED");
    expect(calls).toEqual(["RECEPTION"]);
    const authorizeJob = await prisma.job.findFirstOrThrow({
      where: { documentId: document.id, type: "sri.authorize" },
    });
    const leased = await prisma.job.update({
      where: { id: authorizeJob.id },
      data: {
        status: "LEASED",
        leaseOwner: "w",
        leaseExpiresAt: new Date(Date.now() + 60_000),
        attemptCount: 1,
      },
    });
    reply(document, [authorized(document)]);
    await authorize().run(leased as unknown as Job, context());
    expect((await documentOf(document.id)).state).toBe("AUTHORIZED");
  });

  it("caso D: tras una caída después de autorizar y antes de guardar, se recupera sin consultar otra vez", async () => {
    const { document, job } = await receivedWithJob();
    reply(document, [authorized(document)]);
    await expect(authorize(crashOnce()).run(job, context())).rejects.toThrow("caída simulada");
    expect((await documentOf(document.id)).state).toBe("RECEIVED");
    await authorize().run(job, context());
    expect(calls).toEqual(["AUTHORIZATION"]);
    expect((await documentOf(document.id)).state).toBe("AUTHORIZED");
    expect(
      await prisma.documentArtifact.count({
        where: { documentId: document.id, kind: "AUTHORIZED_XML" },
      }),
    ).toBe(1);
  });

  it("un comprobante que ya no está recibido no se consulta", async () => {
    const { document, job } = await receivedWithJob();
    await prisma.electronicDocument.update({
      where: { id: document.id },
      data: { state: "MANUAL_REVIEW" },
    });
    await authorize().run(job, context());
    expect(calls).toEqual([]);
    expect((await jobOf(job.id)).status).toBe("DONE");
    expect((await documentOf(document.id)).state).toBe("MANUAL_REVIEW");
  });
});

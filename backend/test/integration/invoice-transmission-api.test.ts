// Consulta de la transmisión y solicitud de reconciliación manual sobre HTTP (add-sri-transmission,
// design D15, D18 y D19), con dos empresas. Los estados de la transmisión, los intentos y los jobs
// se escriben directamente en la base de datos: este archivo prueba la API, no los handlers.
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { InvoiceSummaryView, InvoiceView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import type { DbClient } from "../../src/platform/db/database.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createReconcileHandler } from "../../src/modules/fiscal/application/reconcile-handler.ts";
import { DEFAULT_TRANSMISSION_SETTINGS } from "../../src/modules/fiscal/application/transmission-settings.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { createSriEvidenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sri-evidence.ts";
import { createTransmissionUnitOfWork } from "../../src/modules/fiscal/infrastructure/transmission-unit-of-work.ts";
import type {
  SriExchange,
  SriService,
  TransportOutcome,
} from "../../src/modules/sri-engine/application/transport.ts";
import { sriClassifiers } from "../../src/modules/sri-engine/infrastructure/index.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { Job } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { authorizationResponse, response, validityResponse } from "../support/sri-responses.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: InvoiceView & InvoiceSummaryView[] & Record<string, unknown>;
  meta?: { total: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("transmisión de facturas sobre HTTP", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let busy: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  async function emit(company: ReadyCompany, app = api): Promise<InvoiceView> {
    const draft = await request(app.app)
      .post("/api/v1/invoices/drafts")
      .set("Cookie", company.cookies.operator)
      .send({
        emissionPointId: company.emissionPointId,
        buyerPartyId: company.customerId,
        lines: [{ productId: company.productId, quantity: "1" }],
        payments: [{ paymentMethod: "01" }],
      });
    const res = await request(app.app)
      .post("/api/v1/invoices")
      .set("Cookie", company.cookies.operator)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: bodyOf(draft).data.id, expectedVersion: 1 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  }

  /** Avanza el comprobante por transiciones permitidas, con su historial. */
  async function advance(invoice: InvoiceView, path: string[], cause = "TRANSMISSION") {
    let from = invoice.state as string;
    for (const to of path) {
      await prisma.$transaction(async (tx) => {
        await tx.electronicDocument.update({
          where: { id: invoice.id },
          data: {
            state: to,
            ...(to === "AUTHORIZED"
              ? {
                  authorizationNumber: invoice.accessKey,
                  authorizationDate: new Date("2026-10-04T15:30:00Z"),
                  authorizationEnvironment: invoice.environment,
                }
              : {}),
          },
        });
        await tx.documentStateTransition.create({
          data: {
            companyId: a.companyId,
            documentId: invoice.id,
            fromState: from,
            toState: to,
            cause,
            actorType: "SYSTEM",
          },
        });
      });
      from = to;
    }
  }

  async function attempt(invoice: InvoiceView, outcome: string, messages: unknown[]) {
    const created = await prisma.sriAttempt.create({
      data: {
        companyId: a.companyId,
        documentId: invoice.id,
        attemptNumber: (await prisma.sriAttempt.count({ where: { documentId: invoice.id } })) + 1,
        operation: "RECEPTION",
        environment: invoice.environment,
        endpoint: "https://sri-simulado.invalid/recepcion",
        origin: "AUTOMATIC",
        startedAt: new Date("2026-10-04T15:00:00Z"),
        completedAt: new Date("2026-10-04T15:00:01Z"),
        transportOutcome: "RESPONSE",
        httpStatus: 200,
        envelopeSha256: "a".repeat(64),
        envelopeSize: 100,
      },
    });
    const body = Buffer.from("<respuesta-sintetica/>");
    await prisma.sriResponse.create({
      data: {
        attemptId: created.id,
        companyId: a.companyId,
        body,
        sizeBytes: body.length,
        sha256: sha256(body),
        contentType: "text/xml",
      },
    });
    await prisma.sriAttemptResult.create({
      data: {
        attemptId: created.id,
        companyId: a.companyId,
        outcome,
        messages: messages as object[],
        classifierVersion: "sintetico",
      },
    });
  }

  /**
   * Termina el `sri.transmit` que nació al firmar, como si la transmisión ya hubiera corrido:
   * `DONE`, o `STOPPED` con su motivo.
   */
  async function finishTransmit(invoice: InvoiceView, status: "DONE" | "STOPPED", code?: string) {
    await prisma.job.updateMany({
      where: { documentId: invoice.id, type: "sri.transmit" },
      data: {
        status,
        activeDedupeKey: null,
        activeSriDocumentId: null,
        attemptCount: status === "STOPPED" ? 10 : 1,
        ...(code
          ? { lastErrorCode: code, lastErrorClass: "RETRYABLE", lastErrorAt: new Date() }
          : {}),
        completedAt: new Date("2026-10-04T16:00:00Z"),
      },
    });
  }

  const get = (path: string, cookie: string) =>
    request(api.app).get(`/api/v1${path}`).set("Cookie", cookie);
  const reconcile = (invoice: { id: string }, cookie: string, reason: unknown = "Revisado") =>
    request(api.app)
      .post(`/api/v1/invoices/${invoice.id}/reconciliations`)
      .set("Cookie", cookie)
      .send({ reason });
  const audits = () =>
    prisma.auditEvent.findMany({
      where: { action: { startsWith: "invoice.reconciliation" } },
      orderBy: { occurredAt: "asc" },
    });
  const sriJobs = (invoice: { id: string }) =>
    prisma.job.findMany({ where: { documentId: invoice.id }, orderBy: { createdAt: "asc" } });
  const reconciliations = (invoice: { id: string }) =>
    prisma.job.findMany({
      where: { documentId: invoice.id, type: "sri.reconcile" },
      orderBy: { createdAt: "asc" },
    });

  let signed: InvoiceView;
  let stopped: InvoiceView;
  let review: InvoiceView;
  let authorized: InvoiceView;
  let reserved: InvoiceView;
  let foreign: InvoiceView;
  let returned: InvoiceView;
  let ambiguous: InvoiceView;

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_transmission_api");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    busy = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      invoices: {
        signer: {
          signDocument: () =>
            Promise.reject(Object.assign(new Error("saturado"), { code: "CRYPTO_BUSY" })),
        },
      },
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "b", pool, p12Dir });
    signed = await emit(a);
    stopped = await emit(a);
    review = await emit(a);
    authorized = await emit(a);
    reserved = await emit(a, busy);
    foreign = await emit(b);
    returned = await emit(a);
    ambiguous = await emit(a);

    await finishTransmit(stopped, "STOPPED", "SRI_UNAVAILABLE");
    await finishTransmit(review, "DONE");
    await finishTransmit(authorized, "DONE");
    await finishTransmit(returned, "DONE");
    await finishTransmit(ambiguous, "DONE");
    await attempt(returned, "RETURNED", [
      {
        identifier: "35",
        message: "DOCUMENTO INVÁLIDO",
        additionalInformation: "detalle 1",
        type: "ERROR",
      },
      {
        identifier: "999",
        message: "CÓDIGO NUEVO",
        additionalInformation: null,
        type: "ADVERTENCIA",
      },
    ]);
    await advance(returned, ["RETURNED"]);
    await advance(ambiguous, ["SEND_UNKNOWN", "MANUAL_REVIEW"]);
    await attempt(review, "UNKNOWN", []);
    await advance(review, ["SEND_UNKNOWN"]);
    await attempt(review, "SEQUENTIAL_REGISTERED", [
      {
        identifier: "45",
        message: "SECUENCIAL REGISTRADO",
        additionalInformation: "Respuesta sintética",
        type: "ERROR",
      },
    ]);
    await advance(review, ["MANUAL_REVIEW"], "RECONCILIATION");
    await attempt(authorized, "RECEIVED", []);
    await advance(authorized, ["RECEIVED", "AUTHORIZED"], "AUTHORIZATION");
    const xml = Buffer.from(
      `<factura><claveAcceso>${authorized.accessKey}</claveAcceso></factura>`,
    );
    await prisma.documentArtifact.create({
      data: {
        companyId: a.companyId,
        documentId: authorized.id,
        kind: "AUTHORIZED_XML",
        mediaType: "application/xml",
        content: xml,
        sizeBytes: xml.length,
        sha256: sha256(xml),
        metadata: {},
      },
    });
  }, 240_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  describe("consulta", () => {
    it("una factura firmada con su envío programado muestra la interacción en curso", async () => {
      const view = bodyOf(await get(`/invoices/${signed.id}`, a.cookies.operator)).data;
      expect(view.transmission).toEqual({
        inProgress: true,
        stopped: null,
        reconcilable: false,
        authorization: null,
        lastResult: null,
      });
      expect(view.artifact?.sizeBytes).toBeGreaterThan(0);
      expect(view.authorizedArtifact).toBeNull();
    });

    it("la transmisión detenida muestra su motivo, en el detalle y en el listado", async () => {
      const view = bodyOf(await get(`/invoices/${stopped.id}`, a.cookies.admin)).data;
      expect(view.transmission.stopped).toEqual({
        code: "SRI_UNAVAILABLE",
        message: "El SRI no respondió durante los reintentos.",
        at: "2026-10-04T16:00:00.000Z",
      });
      const list = bodyOf(await get("/invoices", a.cookies.admin)).data;
      expect(Object.fromEntries(list.map((item) => [item.id, item.transmissionStopped]))).toEqual({
        [signed.id]: false,
        [stopped.id]: true,
        [review.id]: false,
        [authorized.id]: false,
        [reserved.id]: false,
        [returned.id]: false,
        [ambiguous.id]: false,
      });
    });

    it("la autorizada muestra el número, la fecha, el ambiente y los dos artefactos", async () => {
      const view = bodyOf(await get(`/invoices/${authorized.id}`, a.cookies.operator)).data;
      expect(view.state).toBe("AUTHORIZED");
      expect(view.transmission.authorization).toEqual({
        number: authorized.accessKey,
        authorizedAt: "2026-10-04T15:30:00.000Z",
        environment: "TEST",
      });
      expect(view.transmission.reconcilable).toBe(false);
      expect(view.authorizedArtifact?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(view.authorizedArtifact?.sha256).not.toBe(view.artifact?.sha256);
    });

    it("la de revisión manual muestra todos los mensajes del último resultado", async () => {
      const view = bodyOf(await get(`/invoices/${review.id}`, a.cookies.operator)).data;
      expect(view.transmission.lastResult).toMatchObject({
        operation: "RECEPTION",
        outcome: "SEQUENTIAL_REGISTERED",
        messages: [
          {
            identifier: "45",
            message: "SECUENCIAL REGISTRADO",
            additionalInformation: "Respuesta sintética",
            type: "ERROR",
          },
        ],
      });
    });

    it("el historial resume transiciones e intentos sin respuestas originales ni XML", async () => {
      const res = await get(`/invoices/${review.id}/transmission`, a.cookies.operator);
      expect(res.status).toBe(200);
      const data = bodyOf(res).data as unknown as {
        state: string;
        total: number;
        events: { kind: string; toState?: string; outcome?: string }[];
      };
      expect(data.state).toBe("MANUAL_REVIEW");
      expect(data.events.filter((e) => e.kind === "TRANSITION").map((e) => e.toState)).toEqual([
        "MANUAL_REVIEW",
        "SEND_UNKNOWN",
        "SIGNED",
        "RESERVED",
      ]);
      expect(data.events.filter((e) => e.kind === "ATTEMPT").map((e) => e.outcome)).toEqual([
        "SEQUENTIAL_REGISTERED",
        "UNKNOWN",
      ]);
      expect(data.total).toBe(6);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain("respuesta-sintetica");
      expect(raw).not.toContain("<factura");
      expect(raw).not.toContain("sri-simulado.invalid");
    });

    it('filtra por estado de la transmisión y por "requiere atención", solo en su empresa', async () => {
      const ids = async (query: string) =>
        bodyOf(await get(`/invoices${query}`, a.cookies.admin)).data.map((item) => item.id);
      expect((await ids("?state=MANUAL_REVIEW")).sort()).toEqual([review.id, ambiguous.id].sort());
      expect(await ids("?state=RETURNED")).toEqual([returned.id]);
      expect(await ids("?state=AUTHORIZED")).toEqual([authorized.id]);
      expect((await ids("?attention=true")).sort()).toEqual(
        [stopped.id, review.id, ambiguous.id].sort(),
      );
      const other = bodyOf(await get("/invoices?attention=true", b.cookies.admin)).data;
      expect(other).toEqual([]);
    });

    it("el devuelto muestra todos los mensajes del SRI con su identificador e información", async () => {
      const view = bodyOf(await get(`/invoices/${returned.id}`, a.cookies.operator)).data;
      expect(view.state).toBe("RETURNED");
      expect(view.transmission.reconcilable).toBe(false);
      expect(view.transmission.lastResult?.messages).toEqual([
        {
          identifier: "35",
          message: "DOCUMENTO INVÁLIDO",
          additionalInformation: "detalle 1",
          type: "ERROR",
        },
        {
          identifier: "999",
          message: "CÓDIGO NUEVO",
          additionalInformation: null,
          type: "ADVERTENCIA",
        },
      ]);
    });

    it("el historial de una factura de otra empresa es 404", async () => {
      const res = await get(`/invoices/${foreign.id}/transmission`, a.cookies.admin);
      expect(res.status).toBe(404);
      expect(bodyOf(res).error.code).toBe("INVOICE_NOT_FOUND");
    });
  });

  describe("solicitud de reconciliación manual", () => {
    it("el operador está prohibido y sin sesión no está autenticado; ninguno deja rastro", async () => {
      const before = await audits();
      const forbidden = await reconcile(review, a.cookies.operator);
      expect(forbidden.status).toBe(403);
      const anonymous = await request(api.app)
        .post(`/api/v1/invoices/${review.id}/reconciliations`)
        .send({ reason: "x" });
      expect(anonymous.status).toBe(401);
      expect(await reconciliations(review)).toEqual([]);
      expect(await audits()).toEqual(before);
    });

    it("una factura de otra empresa es 404, un motivo vacío es 400 y un estado no admitido es 409", async () => {
      expect((await reconcile(foreign, a.cookies.admin)).status).toBe(404);
      const empty = await reconcile(review, a.cookies.admin, " ");
      expect(empty.status).toBe(400);
      for (const invoice of [authorized, reserved]) {
        const res = await reconcile(invoice, a.cookies.admin);
        expect(res.status).toBe(409);
        expect(bodyOf(res).error.code).toBe("INVOICE_NOT_RECONCILABLE");
        expect(await reconciliations(invoice)).toEqual([]);
      }
      expect(await audits()).toEqual([]);
    });

    it("en revisión manual programa un job manual y audita la solicitud con su motivo", async () => {
      const res = await reconcile(review, a.cookies.admin, "El SRI confirmó el secuencial");
      expect(res.status).toBe(202);
      const view = bodyOf(res).data;
      expect(view.state).toBe("MANUAL_REVIEW");
      expect(view.transmission).toMatchObject({ inProgress: true, reconcilable: false });
      const [job] = await reconciliations(review);
      expect(job).toMatchObject({
        type: "sri.reconcile",
        status: "PENDING",
        origin: "MANUAL",
        requestedBy: a.adminId,
        reason: "El SRI confirmó el secuencial",
      });
      expect(job!.deadlineAt!.getTime() - job!.scheduledAt.getTime()).toBe(24 * 3_600_000);
      const [event] = await audits();
      expect(event).toMatchObject({
        companyId: a.companyId,
        actorUserId: a.adminId,
        action: "invoice.reconciliation_requested",
        changes: {
          invoiceId: review.id,
          documentNumber: review.documentNumber,
          state: "MANUAL_REVIEW",
          reason: "El SRI confirmó el secuencial",
        },
      });
      expect((job!.payload as { correlationId?: string }).correlationId).toBe(event!.correlationId);
      expect(JSON.stringify(event)).not.toMatch(/soap|<factura|respuesta/i);
    });

    it("con una interacción en curso responde 409 sin otro job ni evento", async () => {
      const res = await reconcile(review, a.cookies.admin);
      expect(res.status).toBe(409);
      expect(bodyOf(res).error.code).toBe("SRI_INTERACTION_IN_PROGRESS");
      expect(await reconciliations(review)).toHaveLength(1);
      expect(await audits()).toHaveLength(1);
    });

    it("dos solicitudes simultáneas sobre una transmisión detenida programan una sola", async () => {
      const results = await Promise.all([
        reconcile(stopped, a.cookies.admin, "Primera"),
        reconcile(stopped, a.cookies.admin, "Segunda"),
      ]);
      expect(results.map((res) => res.status).sort()).toEqual([202, 409]);
      const jobs = await sriJobs(stopped);
      expect(jobs.map((job) => [job.type, job.status])).toEqual([
        ["sri.transmit", "STOPPED"],
        ["sri.reconcile", "PENDING"],
      ]);
      expect(await audits()).toHaveLength(2);
      const view = bodyOf(await get(`/invoices/${stopped.id}`, a.cookies.admin)).data;
      expect(view.transmission).toMatchObject({ inProgress: true, stopped: null });
    });
  });

  describe("conclusión de la reconciliación manual (tarea 11.1)", () => {
    const replies: { service: SriService; outcome: TransportOutcome }[] = [];
    const exchange = (service: SriService, environment: "TEST" | "PRODUCTION") => {
      const index = replies.findIndex((reply) => reply.service === service);
      const outcome = replies.splice(index, 1)[0]!.outcome;
      const result: SriExchange = {
        service,
        environment,
        endpoint: `simulado:${service}`,
        envelope: Buffer.from("<soapenv:Envelope/>"),
        outcome,
      };
      return Promise.resolve(result);
    };
    const handler = () =>
      createReconcileHandler({
        db: prisma,
        evidence: createSriEvidenceRepository(prisma),
        uow: createTransmissionUnitOfWork(prisma as PrismaClient),
        jobs: createPrismaJobStore(prisma as PrismaClient, db.name),
        logger: { info: () => {}, warn: () => {} },
        documents: createDocumentRepository(prisma),
        inquiry: {
          queryAuthorization: (environment) => exchange("AUTHORIZATION", environment),
          queryValidity: (environment) => exchange("VALIDITY", environment),
        },
        classifiers: sriClassifiers,
        settings: DEFAULT_TRANSMISSION_SETTINGS,
      }).handler;
    /** El worker toma el job que programó la solicitud. */
    const runReconcile = async (invoice: InvoiceView) => {
      const job = await prisma.job.update({
        where: { activeDedupeKey: `sri.reconcile:${invoice.id}` },
        data: {
          status: "LEASED",
          leaseOwner: "worker",
          leaseExpiresAt: new Date(Date.now() + 60_000),
          attemptCount: { increment: 1 },
        },
      });
      await handler().run(job as unknown as Job, {
        signal: new AbortController().signal,
        now: () => new Date(),
      });
    };
    const completed = (invoice: InvoiceView) =>
      prisma.auditEvent.findMany({
        where: {
          action: "invoice.reconciliation_completed",
          changes: { path: ["invoiceId"], equals: invoice.id },
        },
      });
    const requestedFor = async (invoice: InvoiceView) =>
      (
        await prisma.auditEvent.findMany({
          where: {
            action: "invoice.reconciliation_requested",
            changes: { path: ["invoiceId"], equals: invoice.id },
          },
        })
      )[0]!;

    it("en revisión manual, la que encuentra la autorización concluye y se audita con el administrador", async () => {
      replies.push({
        service: "AUTHORIZATION",
        outcome: response(
          authorizationResponse(review.accessKey, [
            {
              estado: "AUTORIZADO",
              numeroAutorizacion: review.accessKey,
              fechaAutorizacion: "2026-10-04T10:15:30-05:00",
              ambiente: "PRUEBAS",
            },
          ]),
        ),
      });
      await runReconcile(review);
      const view = bodyOf(await get(`/invoices/${review.id}`, a.cookies.admin)).data;
      expect(view.state).toBe("AUTHORIZED");
      const [event] = await completed(review);
      expect(event).toMatchObject({
        actorUserId: a.adminId,
        correlationId: (await requestedFor(review)).correlationId,
        changes: {
          invoiceId: review.id,
          documentNumber: review.documentNumber,
          result: "AUTHORIZED",
          state: "AUTHORIZED",
        },
      });
      expect(JSON.stringify(event)).not.toMatch(/soap|<factura|Envelope/i);
    });

    it("una transmisión detenida en SIGNED se reactiva con el reenvío de los mismos bytes", async () => {
      replies.push(
        {
          service: "AUTHORIZATION",
          outcome: response(authorizationResponse(stopped.accessKey, [], "0")),
        },
        {
          service: "VALIDITY",
          outcome: response(
            validityResponse({
              accessKey: stopped.accessKey,
              estadoConsulta: "RECHAZADA",
              messages: [
                { identifier: "99", message: "ERROR AL CONSULTAR DATOS DEL SERVICIO WEB" },
              ],
            }),
          ),
        },
      );
      await runReconcile(stopped);
      expect((await sriJobs(stopped)).map((job) => [job.type, job.status])).toEqual([
        ["sri.transmit", "STOPPED"],
        ["sri.reconcile", "DONE"],
        ["sri.transmit", "PENDING"],
      ]);
      const view = bodyOf(await get(`/invoices/${stopped.id}`, a.cookies.admin)).data;
      expect(view.transmission).toMatchObject({ inProgress: true, stopped: null });
      const [event] = await completed(stopped);
      expect(event?.changes).toMatchObject({ result: "RESEND", state: "SIGNED" });
    });

    it("en revisión manual, la que no concluye deja la factura en revisión, sin reenvío", async () => {
      const res = await reconcile(ambiguous, a.cookies.admin, "Revisar otra vez");
      expect(res.status).toBe(202);
      replies.push(
        {
          service: "AUTHORIZATION",
          outcome: response(authorizationResponse(ambiguous.accessKey, [], "0")),
        },
        {
          service: "VALIDITY",
          outcome: response(
            validityResponse({ accessKey: ambiguous.accessKey, estadoConsulta: "RECHAZADA" }),
          ),
        },
      );
      await runReconcile(ambiguous);
      const view = bodyOf(await get(`/invoices/${ambiguous.id}`, a.cookies.admin)).data;
      expect(view.state).toBe("MANUAL_REVIEW");
      expect(view.transmission).toMatchObject({ inProgress: false, reconcilable: true });
      expect(
        (await sriJobs(ambiguous)).filter(
          (job) => job.type === "sri.transmit" && job.status === "PENDING",
        ),
      ).toEqual([]);
      const [event] = await completed(ambiguous);
      expect(event?.changes).toMatchObject({ result: "KEY_UNKNOWN", state: "MANUAL_REVIEW" });
    });
  });
});

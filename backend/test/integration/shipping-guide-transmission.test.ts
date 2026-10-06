// Transmisión de una guía de remisión con los mismos handlers, cola, clasificadores y seguidores que
// los demás comprobantes (add-shipping-guides, tarea 8.3, design D18 y D19), con respuestas del SRI
// SINTÉTICAS con la estructura oficial y sin red: RECIBIDA, DEVUELTA (también con el error 82, que
// la deja devuelta por la clasificación genérica), errores 70, 43 y 45, una respuesta sin estado que
// no es un rechazo, el fallo que demuestra que la solicitud no salió (NOT_SENT), el resultado incierto
// (SEND_UNKNOWN) y su reconciliación por clave, AUTORIZADO, NO AUTORIZADO, MANUAL_REVIEW (también
// cuando la reconciliación automática agota su ventana), la respuesta guardada antes de clasificar (en
// el envío y en la consulta) y su reclasificación sin otra llamada al SRI. Los seguidores de la nota
// de crédito y del inventario la ignoran; la factura sustento no cambia. La reconciliación manual por
// HTTP la prueba `shipping-guide-reconciliation-api.test.ts`. `SRI_TRANSMISSION_ENABLED` sigue
// apagado: el SRI es el doble del arnés.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { DocumentTransitionFollower } from "../../src/modules/fiscal/application/document-transitions.ts";
import { RIDE_JOB_TYPE } from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import {
  authorizationResponse,
  failure,
  receptionResponse,
  response,
  validityResponse,
} from "../support/sri-responses.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertShippingGuide } from "./shipping-guide-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

describe("transmisión de una guía de remisión", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  let sri: CreditNoteTransmission;

  const guide = (state: "SIGNED" | "RECEIVED") => insertShippingGuide(prisma, company, state);
  const stateOf = async (id: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const jobsOf = (doc: TestDocument) =>
    prisma.job.findMany({ where: { documentId: doc.id }, orderBy: { createdAt: "asc" } });
  const untouched = async () => ({
    capacities: await prisma.creditCapacity.count(),
    reservations: await prisma.creditReservation.count(),
    returns: await prisma.stockReturnReservation.count(),
    movements: await prisma.stockMovement.count(),
    invoices: await prisma.electronicDocument.findMany({
      where: { documentType: "01" },
      orderBy: { id: "asc" },
    }),
  });
  const returnedWith = (doc: TestDocument, identifier: string, message = "mensaje sintético") =>
    sri.replies.push(
      response(
        receptionResponse("DEVUELTA", [
          { accessKey: doc.accessKey, messages: [{ identifier, message, type: "ERROR" }] },
        ]),
      ),
    );

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guide_transmission");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Transmisión de guías", 1);
    sri = creditNoteTransmission(prisma, store);
  });

  beforeEach(() => {
    sri.calls.length = 0;
    sri.replies.length = 0;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("RECIBIDA: pasa a pendiente de autorización y programa la consulta", async () => {
    const doc = await guide("SIGNED");
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("RECEIVED");
    expect((await jobsOf(doc)).map((job) => [job.type, job.status])).toEqual([
      ["sri.transmit", "DONE"],
      ["sri.authorize", "PENDING"],
    ]);
  });

  it("DEVUELTA con el error 82: queda devuelta por la clasificación genérica, con su mensaje", async () => {
    const doc = await guide("SIGNED");
    returnedWith(
      doc,
      "82",
      "ERROR EN LA FECHA DE INICIO DE TRANSPORTE (sintético): la fecha de inicio no puede ser menor a la fecha de emisión",
    );
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("RETURNED");
    const result = await prisma.sriAttemptResult.findFirstOrThrow({
      where: { attempt: { documentId: doc.id } },
    });
    expect(result.messages).toEqual([
      {
        identifier: "82",
        message:
          "ERROR EN LA FECHA DE INICIO DE TRANSPORTE (sintético): la fecha de inicio no puede ser menor a la fecha de emisión",
        additionalInformation: null,
        type: "ERROR",
      },
    ]);
    // Sin corrección de devueltos: ningún job más.
    expect((await jobsOf(doc)).map((job) => [job.type, job.status])).toEqual([
      ["sri.transmit", "DONE"],
    ]);
  });

  it("DEVUELTA y NO AUTORIZADO conservan todos los mensajes del SRI con todos sus campos", async () => {
    const MESSAGES = [
      {
        identifier: "35",
        message: "ARCHIVO NO CUMPLE ESTRUCTURA XML (sintético)",
        additionalInformation: "Se encontró un elemento inválido (sintético)",
        type: "ERROR",
      },
      {
        identifier: "60",
        message: "ESTE PROCESO FUE REALIZADO EN EL AMBIENTE DE PRUEBAS",
        type: "ADVERTENCIA",
      },
    ];
    const returned = await guide("SIGNED");
    sri.replies.push(
      response(
        receptionResponse("DEVUELTA", [{ accessKey: returned.accessKey, messages: MESSAGES }]),
      ),
    );
    await sri.transmit().run(await sri.jobFor(returned, "sri.transmit"), sri.context());
    const rejected = await guide("RECEIVED");
    sri.reply(rejected, [
      sri.authorized(rejected, {
        estado: "NO AUTORIZADO",
        comprobante: undefined,
        messages: MESSAGES,
      }),
    ]);
    await sri.authorize().run(await sri.jobFor(rejected, "sri.authorize"), sri.context());
    for (const [doc, state] of [
      [returned, "RETURNED"],
      [rejected, "NOT_AUTHORIZED"],
    ] as const) {
      expect(await stateOf(doc.id)).toBe(state);
      const result = await prisma.sriAttemptResult.findFirstOrThrow({
        where: { attempt: { documentId: doc.id } },
      });
      expect(
        (result.messages as { identifier: string }[]).map((m) => m.identifier),
        state,
      ).toEqual(["35", "60"]);
    }
  });

  it("los errores 70, 43 y 45 no la devuelven: queda verificando y se reconcilia por clave", async () => {
    for (const identifier of ["70", "43", "45"]) {
      const doc = await guide("SIGNED");
      returnedWith(doc, identifier);
      await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
      expect(await stateOf(doc.id), identifier).toBe("SEND_UNKNOWN");
      expect((await jobsOf(doc)).map((job) => job.type)).toEqual(["sri.transmit", "sri.reconcile"]);
    }
  });

  it("una respuesta sin estado no es un rechazo: queda verificando, sin devolverse", async () => {
    const doc = await guide("SIGNED");
    sri.replies.push(response(receptionResponse(null)));
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("SEND_UNKNOWN");
    expect((await jobsOf(doc)).map((job) => job.type)).toEqual(["sri.transmit", "sri.reconcile"]);
  });

  it("NOT_SENT comprobable: no cambia el estado, no reconcilia y reprograma el envío", async () => {
    const doc = await guide("SIGNED");
    sri.replies.push(failure("NOT_SENT"));
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("SIGNED");
    expect((await jobsOf(doc)).map((job) => [job.type, job.status, job.lastErrorCode])).toEqual([
      ["sri.transmit", "PENDING", "SRI_UNAVAILABLE"],
    ]);
    expect(
      await prisma.sriAttempt.findFirstOrThrow({ where: { documentId: doc.id } }),
    ).toMatchObject({ transportOutcome: "NOT_SENT" });
  });

  it("SEND_UNKNOWN: un tiempo agotado no reenvía; la reconciliación por clave la autoriza", async () => {
    const doc = await guide("SIGNED");
    sri.replies.push(failure("REQUEST_TIMEOUT"));
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("SEND_UNKNOWN");
    sri.reply(doc, [sri.authorized(doc)]);
    await sri.reconcile().run(await sri.leasePending(doc.id, "sri.reconcile"), sri.context());
    expect(sri.calls).toEqual(["RECEPTION", "AUTHORIZATION"]);
    expect(await stateOf(doc.id)).toBe("AUTHORIZED");
  });

  it("la reconciliación automática que agota su ventana sin conclusión la deja en revisión manual", async () => {
    const doc = await guide("SIGNED");
    await prisma.electronicDocument.update({
      where: { id: doc.id },
      data: { state: "SEND_UNKNOWN" },
    });
    const attempt = await prisma.sriAttempt.create({
      data: {
        companyId: doc.companyId,
        documentId: doc.id,
        attemptNumber: (await prisma.sriAttempt.count({ where: { documentId: doc.id } })) + 1,
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
        companyId: doc.companyId,
        outcome: "KEY_IN_PROCESS",
        messages: [],
        classifierVersion: "reception/1",
      },
    });
    sri.replies.push(
      response(authorizationResponse(doc.accessKey, [], "0")),
      response(
        validityResponse({
          accessKey: doc.accessKey,
          estadoConsulta: "RECHAZADA",
          messages: [{ identifier: "99", message: "ERROR AL CONSULTAR DATOS DEL SERVICIO WEB" }],
        }),
      ),
    );
    const job = await sri.jobFor(doc, "sri.reconcile");
    await sri.reconcile().run({ ...job, deadlineAt: new Date(Date.now() - 1) }, sri.context());
    expect(await stateOf(doc.id)).toBe("MANUAL_REVIEW");
    expect(sri.calls).not.toContain("RECEPTION");
  });

  it("AUTORIZADO: con su número de autorización, su XML autorizado y el job del RIDE, sin capacidades, inventario ni factura", async () => {
    const before = await untouched();
    const doc = await guide("RECEIVED");
    sri.reply(doc, [sri.authorized(doc)]);
    await sri.authorize().run(await sri.jobFor(doc, "sri.authorize"), sri.context());
    const stored = await prisma.electronicDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect([stored.state, stored.authorizationNumber]).toEqual(["AUTHORIZED", doc.accessKey]);
    expect(
      await prisma.documentArtifact.count({
        where: { documentId: doc.id, kind: "AUTHORIZED_XML" },
      }),
    ).toBe(1);
    expect(await prisma.job.count({ where: { documentId: doc.id, type: RIDE_JOB_TYPE } })).toBe(1);
    // Los seguidores de la nota de crédito y del inventario la ignoran; los registros no cambian.
    expect(await untouched()).toEqual(before);
    expect(await prisma.shippingGuideRecipient.count({ where: { documentId: doc.id } })).toBe(1);
    expect(await prisma.electronicDocumentRecipient.count({ where: { documentId: doc.id } })).toBe(
      1,
    );
  });

  it("dos autorizaciones la dejan en MANUAL_REVIEW", async () => {
    const review = await guide("RECEIVED");
    sri.reply(review, [sri.authorized(review), sri.authorized(review)]);
    await sri.authorize().run(await sri.jobFor(review, "sri.authorize"), sri.context());
    expect(await stateOf(review.id)).toBe("MANUAL_REVIEW");
  });

  it("guarda la respuesta del envío antes de clasificar y la clasifica al retomar sin volver a enviar", async () => {
    const doc = await guide("SIGNED");
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    let failed = false;
    const flaky: DocumentTransitionFollower = () => {
      if (failed) return Promise.resolve();
      failed = true;
      return Promise.reject(new Error("fallo local"));
    };
    const job = await sri.jobFor(doc, "sri.transmit");
    await expect(sri.transmit([...sri.followers, flaky]).run(job, sri.context())).rejects.toThrow(
      "fallo local",
    );
    expect(await stateOf(doc.id)).toBe("SIGNED");
    expect(await prisma.sriResponse.count({ where: { attempt: { documentId: doc.id } } })).toBe(1);
    await sri.transmit([...sri.followers, flaky]).run(job, sri.context());
    expect(sri.calls).toEqual(["RECEPTION"]);
    expect(await stateOf(doc.id)).toBe("RECEIVED");
  });

  it("guarda la respuesta de la consulta antes de clasificar y la reclasifica sin volver a llamar al SRI", async () => {
    const doc = await guide("RECEIVED");
    sri.reply(doc, [sri.authorized(doc, { estado: "NO AUTORIZADO", comprobante: undefined })]);
    let failed = false;
    const flaky: DocumentTransitionFollower = () => {
      if (failed) return Promise.resolve();
      failed = true;
      return Promise.reject(new Error("fallo local"));
    };
    const job = await sri.jobFor(doc, "sri.authorize");
    await expect(sri.authorize([...sri.followers, flaky]).run(job, sri.context())).rejects.toThrow(
      "fallo local",
    );
    expect(await stateOf(doc.id)).toBe("RECEIVED");
    expect(await prisma.sriResponse.count({ where: { attempt: { documentId: doc.id } } })).toBe(1);
    await sri.authorize([...sri.followers, flaky]).run(job, sri.context());
    expect(sri.calls).toEqual(["AUTHORIZATION"]);
    expect(await stateOf(doc.id)).toBe("NOT_AUTHORIZED");
  });
});

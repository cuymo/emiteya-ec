// Transmisión de una nota de débito con los mismos handlers, cola, clasificadores y seguidores que la
// factura y la nota de crédito (add-debit-notes, tarea 7.3, design D17), con respuestas del SRI
// SINTÉTICAS con la estructura oficial: RECIBIDA, DEVUELTA, errores 70, 43 y 45, SEND_UNKNOWN y su
// reconciliación por clave, AUTORIZADO, NO AUTORIZADO, MANUAL_REVIEW, una respuesta sin estado que
// no es un rechazo, la respuesta guardada antes de clasificar y su reclasificación sin otra llamada
// al SRI. Los seguidores de la nota de crédito y del inventario la ignoran. La reconciliación manual
// por HTTP la prueba `debit-note-reconciliation-api.test.ts`.
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
import { insertAuthorizedInvoice } from "./credit-notes-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertDebitNote } from "./debit-notes-harness.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

describe("transmisión de una nota de débito", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  let product: string;
  let sri: CreditNoteTransmission;

  const note = async (state: "SIGNED" | "RECEIVED") => {
    const invoice = await insertAuthorizedInvoice(
      prisma,
      {
        companyId: company.companyId,
        adminId: company.adminId,
        establishmentId: company.points[0]!.establishmentId,
        emissionPointId: company.points[0]!.emissionPointId,
      },
      [{ productId: product, quantity: "10", unitPrice: "10.00", inventoryAffectsStock: true }],
    );
    return insertDebitNote(prisma, company, invoice.id, state);
  };
  const stateOf = async (id: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const jobsOf = (doc: TestDocument) =>
    prisma.job.findMany({ where: { documentId: doc.id }, orderBy: { createdAt: "asc" } });
  const untouched = async () => ({
    capacities: await prisma.creditCapacity.count(),
    reservations: await prisma.creditReservation.count(),
    returns: await prisma.stockReturnReservation.count(),
    movements: await prisma.stockMovement.count(),
  });
  const returnedWith = (doc: TestDocument, identifier: string) =>
    sri.replies.push(
      response(
        receptionResponse("DEVUELTA", [
          {
            accessKey: doc.accessKey,
            messages: [{ identifier, message: "mensaje sintético", type: "ERROR" }],
          },
        ]),
      ),
    );

  beforeAll(async () => {
    db = await createMigratedSchema("debit_note_transmission");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Transmisión de notas de débito", 1);
    product = await insertProduct(prisma, company);
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
    const doc = await note("SIGNED");
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("RECEIVED");
    expect((await jobsOf(doc)).map((job) => [job.type, job.status])).toEqual([
      ["sri.transmit", "DONE"],
      ["sri.authorize", "PENDING"],
    ]);
  });

  it("DEVUELTA: queda devuelta con todos los mensajes del SRI", async () => {
    const doc = await note("SIGNED");
    returnedWith(doc, "35");
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("RETURNED");
    const result = await prisma.sriAttemptResult.findFirstOrThrow({
      where: { attempt: { documentId: doc.id } },
    });
    expect((result.messages as { identifier: string }[]).map((m) => m.identifier)).toEqual(["35"]);
  });

  it("los errores 70, 43 y 45 no la devuelven: queda verificando y se reconcilia por clave", async () => {
    for (const identifier of ["70", "43", "45"]) {
      const doc = await note("SIGNED");
      returnedWith(doc, identifier);
      await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
      expect(await stateOf(doc.id), identifier).toBe("SEND_UNKNOWN");
      expect((await jobsOf(doc)).map((job) => job.type)).toEqual(["sri.transmit", "sri.reconcile"]);
    }
  });

  it("una respuesta sin estado no es un rechazo: queda verificando, sin devolverse", async () => {
    const doc = await note("SIGNED");
    sri.replies.push(response(receptionResponse(null)));
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("SEND_UNKNOWN");
    expect((await jobsOf(doc)).map((job) => job.type)).toEqual(["sri.transmit", "sri.reconcile"]);
    // Una autorización sin estado concluyente tampoco la deja no autorizada: sigue recibida.
    const received = await note("RECEIVED");
    sri.reply(received, [{ estado: "EN PROCESO", ambiente: "PRUEBAS" }]);
    await sri.authorize().run(await sri.jobFor(received, "sri.authorize"), sri.context());
    expect(await stateOf(received.id)).toBe("RECEIVED");
  });

  it("la reconciliación automática que agota su ventana sin conclusión la deja en revisión manual", async () => {
    const doc = await note("SIGNED");
    await prisma.electronicDocument.update({
      where: { id: doc.id },
      data: { state: "SEND_UNKNOWN" },
    });
    // El envío dejó evidencia de que el SRI tenía la clave en proceso.
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
    // La consulta no conoce la clave y la validez no informa nada; la ventana ya se agotó.
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

  it("guarda la respuesta del envío antes de clasificar y la clasifica al retomar sin volver a enviar", async () => {
    const doc = await note("SIGNED");
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
    // La respuesta de la recepción quedó guardada aunque la decisión local falló.
    expect(await stateOf(doc.id)).toBe("SIGNED");
    expect(await prisma.sriResponse.count({ where: { attempt: { documentId: doc.id } } })).toBe(1);
    await sri.transmit([...sri.followers, flaky]).run(job, sri.context());
    expect(sri.calls).toEqual(["RECEPTION"]);
    expect(await stateOf(doc.id)).toBe("RECEIVED");
  });

  it("SEND_UNKNOWN: un tiempo agotado no reenvía; la reconciliación por clave la autoriza", async () => {
    const doc = await note("SIGNED");
    sri.replies.push(failure("REQUEST_TIMEOUT"));
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("SEND_UNKNOWN");
    // La reconciliación consulta por la clave antes de cualquier reenvío.
    sri.reply(doc, [sri.authorized(doc)]);
    await sri.reconcile().run(await sri.leasePending(doc.id, "sri.reconcile"), sri.context());
    expect(sri.calls).toEqual(["RECEPTION", "AUTHORIZATION"]);
    expect(await stateOf(doc.id)).toBe("AUTHORIZED");
  });

  it("AUTORIZADO: con su número de autorización, su XML autorizado y el job del RIDE, sin capacidades ni inventario", async () => {
    const before = await untouched();
    const doc = await note("RECEIVED");
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
    // Los seguidores de la nota de crédito y del inventario la ignoran.
    expect(await untouched()).toEqual(before);
  });

  it("NO AUTORIZADO queda no autorizada con sus mensajes; dos autorizaciones la dejan en MANUAL_REVIEW", async () => {
    const rejected = await note("RECEIVED");
    sri.reply(rejected, [
      sri.authorized(rejected, {
        estado: "NO AUTORIZADO",
        comprobante: undefined,
        messages: [
          { identifier: "65", message: "FECHA EMISION EXTEMPORANEA (sintético)", type: "ERROR" },
        ],
      }),
    ]);
    await sri.authorize().run(await sri.jobFor(rejected, "sri.authorize"), sri.context());
    expect(await stateOf(rejected.id)).toBe("NOT_AUTHORIZED");
    const result = await prisma.sriAttemptResult.findFirstOrThrow({
      where: { attempt: { documentId: rejected.id } },
    });
    expect((result.messages as { identifier: string }[]).map((m) => m.identifier)).toEqual(["65"]);
    const review = await note("RECEIVED");
    sri.reply(review, [sri.authorized(review), sri.authorized(review)]);
    await sri.authorize().run(await sri.jobFor(review, "sri.authorize"), sri.context());
    expect(await stateOf(review.id)).toBe("MANUAL_REVIEW");
  });

  it("guarda la respuesta antes de clasificar y la reclasifica sin volver a llamar al SRI", async () => {
    const doc = await note("RECEIVED");
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
    // La respuesta quedó guardada aunque la decisión local falló.
    expect(await stateOf(doc.id)).toBe("RECEIVED");
    expect(await prisma.sriResponse.count({ where: { attempt: { documentId: doc.id } } })).toBe(1);
    await sri.authorize([...sri.followers, flaky]).run(job, sri.context());
    expect(sri.calls).toEqual(["AUTHORIZATION"]);
    expect(await stateOf(doc.id)).toBe("NOT_AUTHORIZED");
  });
});

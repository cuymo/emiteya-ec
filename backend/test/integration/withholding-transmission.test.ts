// Transmisión de un comprobante de retención con los mismos handlers, cola, clasificadores y
// seguidores que la factura y las notas (add-withholding-receipts, tarea 8.3, design D18), con
// respuestas del SRI SINTÉTICAS con la estructura oficial y sin red: RECIBIDA, DEVUELTA, errores 70,
// 43 y 45, una respuesta sin estado que no es un rechazo, el fallo que demuestra que la solicitud no
// salió (NOT_SENT), el resultado incierto (SEND_UNKNOWN) y su reconciliación por clave, AUTORIZADO,
// NO AUTORIZADO, MANUAL_REVIEW, la respuesta guardada antes de clasificar y su reclasificación sin
// otra llamada al SRI. Los seguidores de la nota de crédito y del inventario la ignoran. La
// reconciliación manual por HTTP la prueba `withholding-reconciliation-api.test.ts`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { DocumentTransitionFollower } from "../../src/modules/fiscal/application/document-transitions.ts";
import { RIDE_JOB_TYPE } from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { failure, receptionResponse, response } from "../support/sri-responses.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";
import { insertSupplier, insertWithholding } from "./withholding-harness.ts";

describe("transmisión de un comprobante de retención", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  let supplier: string;
  let sri: CreditNoteTransmission;

  const note = (state: "SIGNED" | "RECEIVED") =>
    insertWithholding(prisma, company, supplier, state);
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
    db = await createMigratedSchema("withholding_transmission");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Transmisión de retenciones", 1);
    supplier = await insertSupplier(prisma, company);
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
  });

  it("NOT_SENT comprobable: no cambia el estado, no reconcilia y reprograma el envío", async () => {
    const doc = await note("SIGNED");
    sri.replies.push(failure("NOT_SENT"));
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("SIGNED");
    const jobs = await jobsOf(doc);
    expect(jobs.map((job) => [job.type, job.status, job.lastErrorCode])).toEqual([
      ["sri.transmit", "PENDING", "SRI_UNAVAILABLE"],
    ]);
    expect(
      await prisma.sriAttempt.findFirstOrThrow({ where: { documentId: doc.id } }),
    ).toMatchObject({ transportOutcome: "NOT_SENT" });
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
    // Los seguidores de la nota de crédito y del inventario la ignoran; el registro no cambia.
    expect(await untouched()).toEqual(before);
    expect(await prisma.withholdingReceiptLine.count({ where: { documentId: doc.id } })).toBe(1);
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

// Transmisión de una nota de crédito con los mismos handlers, cola y clasificadores que la factura
// (add-credit-notes, tarea 10.3, design D13), con respuestas del SRI SINTÉTICAS con la estructura
// oficial: recibida, devuelta, errores 70, 43 y 45, tiempo agotado con resultado incierto y su
// reconciliación por clave, autorizada, no autorizada, revisión manual y la reclasificación de la
// respuesta guardada. Una nota incierta conserva su capacidad. La reconciliación manual por HTTP la
// prueba `credit-note-reconciliation-api.test.ts`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { DocumentTransitionFollower } from "../../src/modules/fiscal/application/document-transitions.ts";
import { RIDE_JOB_TYPE } from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { Registry } from "@prometheus-io/client";
import { reconcileCreditCapacity } from "../../src/modules/credit-notes/infrastructure/index.ts";
import {
  STALE_RESERVATION_MS,
  registerCreditNoteMetrics,
} from "../../src/modules/credit-notes/infrastructure/metrics.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { failure, receptionResponse, response } from "../support/sri-responses.ts";
import {
  insertAuthorizedInvoice,
  insertCreditNote,
  type AuthorizedInvoiceDocument,
} from "./credit-notes-harness.ts";
import {
  creditNoteTransmission,
  type CreditNoteTransmission,
} from "./credit-note-transmission-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import type { TestDocument } from "./transmission-harness.ts";

describe("transmisión de una nota de crédito", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  let product: string;
  let sri: CreditNoteTransmission;

  const invoice = () =>
    insertAuthorizedInvoice(
      prisma,
      {
        companyId: company.companyId,
        adminId: company.adminId,
        establishmentId: company.points[0]!.establishmentId,
        emissionPointId: company.points[0]!.emissionPointId,
      },
      [{ productId: product, quantity: "10", unitPrice: "10.00" }],
    );
  const note = (target: AuthorizedInvoiceDocument, state: "SIGNED" | "RECEIVED") =>
    insertCreditNote(prisma, company, target, { lines: [{ position: 1, quantity: "1" }], state });
  const stateOf = async (id: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const statusOf = async (doc: TestDocument) =>
    (await prisma.creditReservation.findFirstOrThrow({ where: { creditNoteId: doc.id } })).status;
  const jobsOf = (doc: TestDocument) =>
    prisma.job.findMany({ where: { documentId: doc.id }, orderBy: { createdAt: "asc" } });
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
    db = await createMigratedSchema("credit_note_transmission");
    prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Transmisión de notas", 1);
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

  it("recibida: pasa a pendiente de autorización y programa la consulta; la capacidad sigue reservada", async () => {
    const doc = await note(await invoice(), "SIGNED");
    sri.replies.push(response(receptionResponse("RECIBIDA")));
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("RECEIVED");
    expect((await jobsOf(doc)).map((job) => [job.type, job.status])).toEqual([
      ["sri.transmit", "DONE"],
      ["sri.authorize", "PENDING"],
    ]);
    expect(await statusOf(doc)).toBe("RESERVED");
  });

  it("devuelta: queda devuelta con sus mensajes y libera su capacidad", async () => {
    const doc = await note(await invoice(), "SIGNED");
    returnedWith(doc, "35");
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("RETURNED");
    const result = await prisma.sriAttemptResult.findFirstOrThrow({
      where: { attempt: { documentId: doc.id } },
    });
    expect((result.messages as { identifier: string }[]).map((m) => m.identifier)).toEqual(["35"]);
    expect(await statusOf(doc)).toBe("RELEASED");
  });

  it("los errores 70, 43 y 45 no la devuelven: queda verificando y se reconcilia por clave, con la capacidad reservada", async () => {
    for (const identifier of ["70", "43", "45"]) {
      const doc = await note(await invoice(), "SIGNED");
      returnedWith(doc, identifier);
      await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
      expect(await stateOf(doc.id), identifier).toBe("SEND_UNKNOWN");
      expect((await jobsOf(doc)).map((job) => job.type)).toEqual(["sri.transmit", "sri.reconcile"]);
      expect(await statusOf(doc)).toBe("RESERVED");
    }
  });

  it("un tiempo agotado deja el resultado incierto sin reenviar; la reconciliación por clave la autoriza", async () => {
    const doc = await note(await invoice(), "SIGNED");
    sri.replies.push(failure("REQUEST_TIMEOUT"));
    await sri.transmit().run(await sri.jobFor(doc, "sri.transmit"), sri.context());
    expect(await stateOf(doc.id)).toBe("SEND_UNKNOWN");
    expect(await statusOf(doc)).toBe("RESERVED");
    // La reconciliación consulta por la clave antes de cualquier reenvío.
    sri.reply(doc, [sri.authorized(doc)]);
    await sri.reconcile().run(await sri.leasePending(doc.id, "sri.reconcile"), sri.context());
    expect(sri.calls).toEqual(["RECEPTION", "AUTHORIZATION"]);
    expect(await stateOf(doc.id)).toBe("AUTHORIZED");
    expect(await statusOf(doc)).toBe("APPLIED");
  });

  it("autorizada: con su número de autorización, su XML autorizado, el job del RIDE y su crédito aplicado", async () => {
    const doc = await note(await invoice(), "RECEIVED");
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
    expect(await statusOf(doc)).toBe("APPLIED");
  });

  it("no autorizada y en revisión manual: libera, o conserva la capacidad hasta que una reconciliación concluya", async () => {
    const rejected = await note(await invoice(), "RECEIVED");
    sri.reply(rejected, [
      sri.authorized(rejected, { estado: "NO AUTORIZADO", comprobante: undefined }),
    ]);
    await sri.authorize().run(await sri.jobFor(rejected, "sri.authorize"), sri.context());
    expect([await stateOf(rejected.id), await statusOf(rejected)]).toEqual([
      "NOT_AUTHORIZED",
      "RELEASED",
    ]);
    const review = await note(await invoice(), "RECEIVED");
    sri.reply(review, [sri.authorized(review), sri.authorized(review)]);
    await sri.authorize().run(await sri.jobFor(review, "sri.authorize"), sri.context());
    expect([await stateOf(review.id), await statusOf(review)]).toEqual([
      "MANUAL_REVIEW",
      "RESERVED",
    ]);
  });

  it("no autorizada: queda no autorizada con los mensajes del SRI y su capacidad liberada", async () => {
    const doc = await note(await invoice(), "RECEIVED");
    sri.reply(doc, [
      sri.authorized(doc, {
        estado: "NO AUTORIZADO",
        comprobante: undefined,
        messages: [
          { identifier: "65", message: "FECHA EMISION EXTEMPORANEA (sintético)", type: "ERROR" },
        ],
      }),
    ]);
    await sri.authorize().run(await sri.jobFor(doc, "sri.authorize"), sri.context());
    expect(await stateOf(doc.id)).toBe("NOT_AUTHORIZED");
    const result = await prisma.sriAttemptResult.findFirstOrThrow({
      where: { attempt: { documentId: doc.id } },
    });
    expect(
      (result.messages as { identifier: string; message: string }[]).map((m) => [
        m.identifier,
        m.message,
      ]),
    ).toEqual([["65", "FECHA EMISION EXTEMPORANEA (sintético)"]]);
    expect(await statusOf(doc)).toBe("RELEASED");
  });

  it("autorizada: el job del RIDE nace en la misma transacción que la autorización y el crédito aplicado", async () => {
    const doc = await note(await invoice(), "RECEIVED");
    sri.reply(doc, [sri.authorized(doc)]);
    const rideJobs = () => prisma.job.count({ where: { documentId: doc.id, type: RIDE_JOB_TYPE } });
    let failed = false;
    const flaky: DocumentTransitionFollower = () => {
      if (failed) return Promise.resolve();
      failed = true;
      return Promise.reject(new Error("fallo local"));
    };
    const job = await sri.jobFor(doc, "sri.authorize");
    // Un fallo dentro de la operación de la autorización revierte la transición, el job del RIDE
    // y el crédito aplicado a la vez.
    await expect(sri.authorize([...sri.followers, flaky]).run(job, sri.context())).rejects.toThrow(
      "fallo local",
    );
    expect([await stateOf(doc.id), await rideJobs(), await statusOf(doc)]).toEqual([
      "RECEIVED",
      0,
      "RESERVED",
    ]);
    // Al repetirla, los tres quedan juntos, con un solo job del RIDE.
    await sri.authorize([...sri.followers, flaky]).run(job, sri.context());
    expect([await stateOf(doc.id), await rideJobs(), await statusOf(doc)]).toEqual([
      "AUTHORIZED",
      1,
      "APPLIED",
    ]);
  });

  it("la señal de la alerta cuenta las reservas sin concluir de más de 24 horas", async () => {
    const review = await note(await invoice(), "RECEIVED");
    sri.reply(review, [sri.authorized(review), sri.authorized(review)]);
    await sri.authorize().run(await sri.jobFor(review, "sri.authorize"), sri.context());
    expect(await stateOf(review.id)).toBe("MANUAL_REVIEW");
    const gauge = async (now: Date) => {
      const registry = new Registry();
      registerCreditNoteMetrics(registry, { prisma, now: () => now });
      const text = await registry.getSingleMetricAsString(
        "credit_note_reservations_unconcluded_over_24h",
      );
      return Number(/^credit_note_reservations_unconcluded_over_24h (\d+)$/m.exec(text)![1]);
    };
    // Hoy ninguna lleva 24 horas; pasado el plazo, cuenta cada reserva RESERVED, incluida la de la
    // nota en revisión manual, y ninguna concluida.
    expect(await gauge(new Date())).toBe(0);
    const reserved = await prisma.creditReservation.count({ where: { status: "RESERVED" } });
    expect(reserved).toBeGreaterThan(0);
    expect(await gauge(new Date(Date.now() + STALE_RESERVATION_MS + 60_000))).toBe(reserved);
  });

  it("la decisión local que falla después de guardar la respuesta se reclasifica sin volver a llamar al SRI", async () => {
    const doc = await note(await invoice(), "RECEIVED");
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
    expect([await stateOf(doc.id), await statusOf(doc)]).toEqual(["RECEIVED", "RESERVED"]);
    await sri.authorize([...sri.followers, flaky]).run(job, sri.context());
    expect(sri.calls).toEqual(["AUTHORIZATION"]);
    expect([await stateOf(doc.id), await statusOf(doc)]).toEqual(["NOT_AUTHORIZED", "RELEASED"]);
    expect(await reconcileCreditCapacity(prisma, company.companyId)).toEqual([]);
  });
});

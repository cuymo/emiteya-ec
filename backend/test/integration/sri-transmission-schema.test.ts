// Invariantes de la migración add_sri_transmission en PostgreSQL (design D3, D5, D7 y D16): la tabla
// de transiciones de la transmisión con terminales inmutables, la autorización solo en AUTHORIZED e
// inmutable, la evidencia de solo agregado por empresa y la cola con un job activo por clave y una
// interacción activa con el SRI por comprobante. Escribe directamente en las tablas.
import { createHash, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import type { DbClient } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  insertFiscalCompany,
  key,
  reservationInput,
  type FiscalCompany,
} from "./fiscal-harness.ts";

const STATES = [
  "RESERVED",
  "SIGNED",
  "SEND_UNKNOWN",
  "RECEIVED",
  "RETURNED",
  "AUTHORIZED",
  "NOT_AUTHORIZED",
  "MANUAL_REVIEW",
] as const;
type State = (typeof STATES)[number];

/** Tabla de transiciones de design D3. */
const ALLOWED = new Set([
  "RESERVED>SIGNED",
  "SIGNED>RECEIVED",
  "SIGNED>RETURNED",
  "SIGNED>SEND_UNKNOWN",
  "SEND_UNKNOWN>RECEIVED",
  "SEND_UNKNOWN>AUTHORIZED",
  "SEND_UNKNOWN>NOT_AUTHORIZED",
  "SEND_UNKNOWN>RETURNED",
  "SEND_UNKNOWN>MANUAL_REVIEW",
  "RECEIVED>AUTHORIZED",
  "RECEIVED>NOT_AUTHORIZED",
  "RECEIVED>MANUAL_REVIEW",
  "MANUAL_REVIEW>RECEIVED",
  "MANUAL_REVIEW>AUTHORIZED",
  "MANUAL_REVIEW>NOT_AUTHORIZED",
]);

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const randomKey = () => Array.from({ length: 49 }, () => randomInt(10)).join("");
const AT = new Date("2026-10-04T15:00:00Z");

describe("invariantes de la transmisión al SRI en la base de datos", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;

  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const authorization = (accessKey: string) => ({
    authorizationNumber: accessKey,
    authorizationDate: AT,
    authorizationEnvironment: "TEST",
  });

  /** El XML firmado que exige todo estado posterior a RESERVED. */
  async function signedArtifact(
    tx: Pick<DbClient, "documentArtifact">,
    document: { id: string; companyId: string; accessKey: string },
  ) {
    const content = Buffer.from(`<factura>${document.accessKey}</factura>`);
    await tx.documentArtifact.create({
      data: {
        companyId: document.companyId,
        documentId: document.id,
        kind: "SIGNED_XML",
        mediaType: "application/xml",
        content,
        sizeBytes: content.length,
        sha256: sha256(content),
        metadata: {},
      },
    });
  }

  /** Comprobante creado directamente en un estado, con su artefacto firmado cuando corresponde. */
  async function documentIn(state: State, company: FiscalCompany = companyA) {
    const reservation = await createSequentialReservation(
      createFiscalUnitOfWork(db.database.prisma),
    ).reserve(reservationInput(key(company)));
    const sequential = String(reservation.sequential).padStart(9, "0");
    const accessKey = randomKey();
    return prisma.$transaction(async (tx) => {
      const document = await tx.electronicDocument.create({
        data: {
          companyId: company.companyId,
          documentType: "01",
          environment: "TEST",
          establishmentId: company.points[0]!.establishmentId,
          emissionPointId: company.points[0]!.emissionPointId,
          documentNumber: `001-001-${sequential}`,
          sequential: reservation.sequential,
          reservationId: reservation.reservationId,
          accessKey,
          numericCode: "12345678",
          issueDate: new Date("2026-10-04"),
          state,
          snapshot: { snapshotVersion: 1 },
          schemaVersion: "1.1.0",
          buyerIdentification: "9999999999999",
          buyerName: "CONSUMIDOR FINAL",
          total: "11.50",
          createdBy: company.adminId,
          signedAt: state === "RESERVED" ? null : AT,
          ...(state === "AUTHORIZED" ? authorization(accessKey) : {}),
        },
      });
      if (state !== "RESERVED") await signedArtifact(tx, document);
      return document;
    });
  }

  /** Desde RESERVED firma antes, para que solo la tabla de transiciones decida. */
  const moveTo = (
    document: { id: string; companyId: string; accessKey: string; state: string },
    state: State,
  ) =>
    prisma.$transaction(async (tx) => {
      if (document.state === "RESERVED") await signedArtifact(tx, document);
      return tx.electronicDocument.update({
        where: { id: document.id },
        data: {
          state,
          ...(document.state === "RESERVED" ? { signedAt: AT } : {}),
          ...(state === "AUTHORIZED" ? authorization(document.accessKey) : {}),
        },
      });
    });

  async function attempt(
    document: { id: string; companyId: string },
    overrides: Record<string, unknown> = {},
  ) {
    return prisma.sriAttempt.create({
      data: {
        companyId: document.companyId,
        documentId: document.id,
        attemptNumber: 1,
        operation: "RECEPTION",
        environment: "TEST",
        endpoint: "https://celcer.sri.gob.ec/simulado",
        origin: "AUTOMATIC",
        startedAt: AT,
        completedAt: AT,
        transportOutcome: "RESPONSE",
        httpStatus: 200,
        envelopeSha256: "a".repeat(64),
        envelopeSize: 10,
        ...overrides,
      },
    });
  }

  const job = (overrides: Record<string, unknown> = {}) => {
    const dedupeKey = (overrides.dedupeKey as string | undefined) ?? `sri.transmit:${randomUUID()}`;
    const status = (overrides.status as string | undefined) ?? "PENDING";
    const active = status === "PENDING" || status === "LEASED";
    const documentId = overrides.documentId as string | undefined;
    const type = (overrides.type as string | undefined) ?? "sri.transmit";
    return prisma.job.create({
      data: {
        companyId: companyA.companyId,
        type,
        dedupeKey,
        activeDedupeKey: active ? dedupeKey : null,
        activeSriDocumentId: active && documentId && type.startsWith("sri.") ? documentId : null,
        status,
        scheduledAt: AT,
        nextAttemptAt: AT,
        maxAttempts: 5,
        origin: "AUTOMATIC",
        completedAt: active ? null : AT,
        ...overrides,
      },
    });
  };

  beforeAll(async () => {
    db = await createMigratedSchema("sri_transmission_schema");
    prisma = db.database.prisma;
    companyA = await insertFiscalCompany(prisma, "Empresa A", 1);
    companyB = await insertFiscalCompany(prisma, "Empresa B", 1);
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("comprobante", () => {
    it("permite exactamente las transiciones de la tabla y rechaza las demás", async () => {
      const outcomes: string[] = [];
      for (const from of STATES) {
        for (const to of STATES) {
          if (from === to) continue;
          const document = await documentIn(from);
          const error = await fails(moveTo(document, to));
          const transition = `${from}>${to}`;
          if (ALLOWED.has(transition) !== (error === null))
            outcomes.push(`${transition}: ${error}`);
        }
      }
      expect(outcomes).toEqual([]);
    });

    it("conserva válidos los comprobantes reservados y firmados del cambio anterior", async () => {
      const reserved = await documentIn("RESERVED");
      const signed = await documentIn("SIGNED");
      expect([reserved.state, signed.state]).toEqual(["RESERVED", "SIGNED"]);
      expect(signed.authorizationNumber).toBeNull();
    });

    it("exige la autorización solo en AUTHORIZED, con el número igual a la clave y su ambiente", async () => {
      const received = await documentIn("RECEIVED");
      expect(
        await fails(
          prisma.electronicDocument.update({
            where: { id: received.id },
            data: { state: "AUTHORIZED" },
          }),
        ),
      ).toContain("electronic_document_authorization_check");
      expect(
        await fails(
          prisma.electronicDocument.update({
            where: { id: received.id },
            data: { state: "AUTHORIZED", ...authorization(randomKey()) },
          }),
        ),
      ).toContain("electronic_document_authorization_check");
      expect(
        await fails(
          prisma.electronicDocument.update({
            where: { id: received.id },
            data: {
              state: "AUTHORIZED",
              ...authorization(received.accessKey),
              authorizationEnvironment: "PRODUCTION",
            },
          }),
        ),
      ).toContain("electronic_document_authorization_check");
      expect(
        await fails(
          prisma.electronicDocument.update({
            where: { id: received.id },
            data: authorization(received.accessKey),
          }),
        ),
      ).toContain("electronic_document_authorization_check");
    });

    it("la autorización y la firma no cambian una vez escritas", async () => {
      const authorized = await documentIn("AUTHORIZED");
      expect(
        await fails(
          prisma.electronicDocument.update({
            where: { id: authorized.id },
            data: { authorizationDate: new Date("2026-10-05T00:00:00Z") },
          }),
        ),
      ).toContain("la autorización de un comprobante no cambia");
      const signed = await documentIn("SIGNED");
      expect(
        await fails(
          prisma.electronicDocument.update({
            where: { id: signed.id },
            data: { signedAt: new Date("2026-10-05T00:00:00Z") },
          }),
        ),
      ).toContain("no cambia su firma");
    });

    it("todo estado posterior a RESERVED exige firma y artefacto firmado", async () => {
      const reservation = await createSequentialReservation(
        createFiscalUnitOfWork(db.database.prisma),
      ).reserve(reservationInput(key(companyA)));
      expect(
        await fails(
          prisma.electronicDocument.create({
            data: {
              companyId: companyA.companyId,
              documentType: "01",
              environment: "TEST",
              establishmentId: companyA.points[0]!.establishmentId,
              emissionPointId: companyA.points[0]!.emissionPointId,
              documentNumber: `001-001-${String(reservation.sequential).padStart(9, "0")}`,
              sequential: reservation.sequential,
              reservationId: reservation.reservationId,
              accessKey: randomKey(),
              numericCode: "12345678",
              issueDate: new Date("2026-10-04"),
              state: "RECEIVED",
              signedAt: AT,
              snapshot: { snapshotVersion: 1 },
              schemaVersion: "1.1.0",
              buyerIdentification: "9999999999999",
              buyerName: "CONSUMIDOR FINAL",
              total: "1.00",
              createdBy: companyA.adminId,
            },
          }),
        ),
      ).toContain("firmado sin su artefacto");
    });

    it("el historial admite los estados y causas de la transmisión", async () => {
      const document = await documentIn("RECEIVED");
      const transition = await prisma.documentStateTransition.create({
        data: {
          companyId: companyA.companyId,
          documentId: document.id,
          fromState: "SIGNED",
          toState: "RECEIVED",
          cause: "TRANSMISSION",
          actorType: "SYSTEM",
          metadata: { sriAttemptId: randomUUID() },
        },
      });
      expect(transition.toState).toBe("RECEIVED");
    });
  });

  describe("evidencia y artefactos", () => {
    it("los intentos, las respuestas y los resultados son de solo agregado", async () => {
      const document = await documentIn("SIGNED");
      const created = await attempt(document);
      await prisma.sriResponse.create({
        data: {
          attemptId: created.id,
          companyId: companyA.companyId,
          body: Buffer.from("<soap/>"),
          sizeBytes: 7,
          sha256: sha256(Buffer.from("<soap/>")),
          contentType: "text/xml",
        },
      });
      await prisma.sriAttemptResult.create({
        data: {
          attemptId: created.id,
          companyId: companyA.companyId,
          outcome: "RECEIVED",
          messages: [],
          classifierVersion: "1",
        },
      });
      for (const change of [
        prisma.sriAttempt.update({ where: { id: created.id }, data: { httpStatus: 500 } }),
        prisma.sriAttempt.delete({ where: { id: created.id } }),
        prisma.sriResponse.update({ where: { attemptId: created.id }, data: { truncated: true } }),
        prisma.sriAttemptResult.update({
          where: { attemptId: created.id },
          data: { outcome: "RETURNED" },
        }),
        // La respuesta original y su resultado tampoco se borran ni se vacían.
        prisma.sriResponse.delete({ where: { attemptId: created.id } }),
        prisma.sriAttemptResult.delete({ where: { attemptId: created.id } }),
        prisma.$executeRawUnsafe(`TRUNCATE "${db.name}"."sri_response" CASCADE`),
        prisma.$executeRawUnsafe(`TRUNCATE "${db.name}"."sri_attempt_result" CASCADE`),
        prisma.$executeRawUnsafe(`TRUNCATE "${db.name}"."sri_attempt" CASCADE`),
      ]) {
        expect(await fails(change)).toContain("no admite");
      }
      expect(await prisma.sriResponse.count({ where: { attemptId: created.id } })).toBe(1);
      expect(await prisma.sriAttemptResult.count({ where: { attemptId: created.id } })).toBe(1);
    });

    it("cada intento tiene a lo sumo una respuesta y un resultado", async () => {
      const document = await documentIn("SIGNED");
      const created = await attempt(document);
      const result = () =>
        prisma.sriAttemptResult.create({
          data: {
            attemptId: created.id,
            companyId: companyA.companyId,
            outcome: "UNKNOWN",
            messages: [],
            classifierVersion: "1",
          },
        });
      await result();
      expect(await fails(result())).not.toBeNull();
    });

    it("rechaza un intento de una empresa sobre el comprobante de otra", async () => {
      const document = await documentIn("SIGNED");
      expect(await fails(attempt({ id: document.id, companyId: companyB.companyId }))).toContain(
        "sri_attempt_company_id_document_id_fkey",
      );
    });

    it("rechaza valores fuera de dominio en los intentos y resultados", async () => {
      const document = await documentIn("SIGNED");
      expect(await fails(attempt(document, { transportOutcome: "TIMEOUT" }))).toContain(
        "sri_attempt_values_check",
      );
      expect(
        await fails(attempt(document, { transportOutcome: "NOT_SENT", httpStatus: 200 })),
      ).toContain("sri_attempt_values_check");
      expect(await fails(attempt(document, { origin: "MANUAL" }))).toContain(
        "sri_attempt_values_check",
      );
    });

    it("un comprobante conserva su XML firmado y su XML autorizado, uno de cada tipo", async () => {
      const document = await documentIn("AUTHORIZED");
      const authorized = () => {
        const content = Buffer.from("<autorizado/>");
        return prisma.documentArtifact.create({
          data: {
            companyId: companyA.companyId,
            documentId: document.id,
            kind: "AUTHORIZED_XML",
            mediaType: "application/xml",
            content,
            sizeBytes: content.length,
            sha256: sha256(content),
            metadata: {},
          },
        });
      };
      await authorized();
      const kinds = await prisma.documentArtifact.findMany({
        where: { documentId: document.id },
        select: { kind: true },
        orderBy: { kind: "asc" },
      });
      expect(kinds.map((row) => row.kind)).toEqual(["AUTHORIZED_XML", "SIGNED_XML"]);
      expect(await fails(authorized())).not.toBeNull();
    });
  });

  describe("cola de jobs", () => {
    it("no admite dos jobs activos con la misma clave; uno terminado no bloquea", async () => {
      const dedupeKey = `sri.authorize:${randomUUID()}`;
      await job({ dedupeKey, type: "sri.authorize", status: "DONE" });
      await job({ dedupeKey, type: "sri.authorize" });
      expect(await fails(job({ dedupeKey, type: "sri.authorize" }))).toContain("active_dedupe_key");
    });

    it("no admite dos jobs del SRI activos para el mismo comprobante, en cualquier fase", async () => {
      const document = await documentIn("SIGNED");
      await job({ documentId: document.id, type: "sri.transmit" });
      expect(
        await fails(
          job({
            documentId: document.id,
            type: "sri.reconcile",
            dedupeKey: `sri.reconcile:${document.id}`,
          }),
        ),
      ).toContain("active_sri_document_id");
    });

    it("el traspaso entre fases cabe en una transacción sin chocar con los índices", async () => {
      const document = await documentIn("RECEIVED");
      const transmit = await job({
        documentId: document.id,
        type: "sri.transmit",
        dedupeKey: `sri.transmit:${document.id}`,
      });
      await prisma.$transaction(async (tx) => {
        await tx.job.update({
          where: { id: transmit.id },
          data: {
            status: "DONE",
            activeDedupeKey: null,
            activeSriDocumentId: null,
            completedAt: AT,
          },
        });
        await tx.job.create({
          data: {
            companyId: companyA.companyId,
            type: "sri.authorize",
            dedupeKey: `sri.authorize:${document.id}`,
            activeDedupeKey: `sri.authorize:${document.id}`,
            documentId: document.id,
            activeSriDocumentId: document.id,
            status: "PENDING",
            scheduledAt: AT,
            nextAttemptAt: AT,
            maxAttempts: 5,
            origin: "AUTOMATIC",
          },
        });
      });
      expect(
        await prisma.job.count({
          where: { documentId: document.id, status: { in: ["PENDING", "LEASED"] } },
        }),
      ).toBe(1);
    });

    it("rechaza estados del job incoherentes", async () => {
      expect(await fails(job({ status: "LEASED" }))).toContain("job_values_check");
      expect(await fails(job({ origin: "MANUAL" }))).toContain("job_values_check");
      expect(await fails(job({ status: "DONE", activeDedupeKey: "x", completedAt: AT }))).toContain(
        "job_values_check",
      );
      expect(await fails(job({ type: "SRI TRANSMIT" }))).toContain("job_values_check");
    });
  });
});

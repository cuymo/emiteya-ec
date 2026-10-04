// Repositorio de la evidencia de los intentos (add-sri-transmission, tarea 7.1, design D7 y D8):
// el intento y su respuesta original juntos, la reconstrucción exacta del transporte para volver a
// clasificar, el resultado aparte y el artefacto AUTHORIZED_XML junto al SIGNED_XML.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createSriEvidenceRepository } from "../../src/modules/fiscal/infrastructure/prisma-sri-evidence.ts";
import type { NewSriAttempt } from "../../src/modules/fiscal/application/transmission-ports.ts";
import type { TransportOutcome } from "../../src/modules/sri-engine/application/transport.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, sha256, type TestDocument } from "./transmission-harness.ts";

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 4, 15, 0, seconds));
const ENVELOPE = Buffer.from("<soapenv:Envelope/>");

describe("evidencia de los intentos con el SRI", () => {
  let db: MigratedSchema;
  let company: FiscalCompany;
  let document: TestDocument;

  const attemptOf = (outcome: TransportOutcome, jobId: string | null = null): NewSriAttempt => ({
    companyId: company.companyId,
    documentId: document.id,
    jobId,
    operation: "RECEPTION",
    environment: "TEST",
    endpoint: "https://sri-simulado.invalid/recepcion",
    origin: "AUTOMATIC",
    initiatedBy: null,
    outcome,
    envelope: ENVELOPE,
    sentArtifact: { sha256: "b".repeat(64), sizeBytes: 321 },
  });

  beforeAll(async () => {
    db = await createMigratedSchema("sri_evidence");
    company = await insertFiscalCompany(db.database.prisma, "Empresa A", 1);
    document = await insertDocument(db.database.prisma, company, "SIGNED");
  });

  afterAll(async () => {
    await db.drop();
  });

  it("guarda el intento con su respuesta exacta y la reconstruye tal cual para clasificarla", async () => {
    const evidence = createSriEvidenceRepository(db.database.prisma);
    const body = Buffer.concat([Buffer.from("<soap:Envelope>ñ"), Buffer.from([0xff, 0x00])]);
    const outcome: TransportOutcome = {
      kind: "RESPONSE",
      httpStatus: 200,
      headers: { "content-type": "text/xml;charset=UTF-8", date: "Sun, 04 Oct 2026 15:00:01 GMT" },
      body,
      truncated: true,
      startedAt: at(0),
      headersAt: at(1),
      completedAt: at(2),
    };
    const stored = await evidence.record(attemptOf(outcome));
    expect(stored).toMatchObject({ attemptNumber: 1, operation: "RECEPTION", origin: "AUTOMATIC" });
    expect(stored.outcome).toEqual(outcome);
    const row = await db.database.prisma.sriAttempt.findUniqueOrThrow({
      where: { id: stored.id },
      include: { response: true },
    });
    expect(row).toMatchObject({
      envelopeSha256: sha256(ENVELOPE),
      envelopeSize: ENVELOPE.length,
      sentArtifactSha256: "b".repeat(64),
      sentArtifactSize: 321,
      transportOutcome: "RESPONSE",
      httpStatus: 200,
    });
    expect(row.response).toMatchObject({
      sizeBytes: body.length,
      sha256: sha256(body),
      truncated: true,
    });
  });

  it("un fallo de transporte o un cuerpo vacío no dejan respuesta original", async () => {
    const evidence = createSriEvidenceRepository(db.database.prisma);
    const timeout: TransportOutcome = {
      kind: "REQUEST_TIMEOUT",
      errorCode: "REQUEST_TIMEOUT",
      startedAt: at(10),
      headersAt: null,
      completedAt: at(40),
    };
    const failed = await evidence.record(attemptOf(timeout));
    expect(failed.attemptNumber).toBe(2);
    expect(failed.outcome).toEqual(timeout);
    const empty: TransportOutcome = {
      kind: "RESPONSE",
      httpStatus: 200,
      headers: {},
      body: Buffer.alloc(0),
      truncated: false,
      startedAt: at(41),
      headersAt: at(41),
      completedAt: at(41),
    };
    const stored = await evidence.record(attemptOf(empty));
    expect(stored.outcome).toEqual(empty);
    expect(
      await db.database.prisma.sriResponse.count({
        where: { attemptId: { in: [failed.id, stored.id] } },
      }),
    ).toBe(0);
  });

  it("el intento del job sin resultado se encuentra; con su resultado, ya no", async () => {
    const prisma = db.database.prisma;
    const evidence = createSriEvidenceRepository(prisma);
    const job = await prisma.job.create({
      data: {
        companyId: company.companyId,
        type: "sri.transmit",
        dedupeKey: `sri.transmit:${document.id}`,
        documentId: document.id,
        status: "DONE",
        scheduledAt: at(0),
        nextAttemptAt: at(0),
        maxAttempts: 3,
        origin: "AUTOMATIC",
        completedAt: at(50),
      },
    });
    const outcome: TransportOutcome = {
      kind: "CONNECTION_LOST",
      errorCode: "UND_ERR_SOCKET",
      startedAt: at(42),
      headersAt: null,
      completedAt: at(43),
    };
    const first = await evidence.record(attemptOf(outcome, job.id));
    const second = await evidence.record(attemptOf(outcome, job.id));
    expect((await evidence.unclassified(company.companyId, job.id))?.id).toBe(second.id);
    await evidence.recordResult({
      companyId: company.companyId,
      attemptId: second.id,
      outcome: "UNKNOWN",
      messages: [{ identifier: null, message: null, additionalInformation: null, type: null }],
      parsed: { reason: "CONNECTION_LOST" },
      classifierVersion: "reception/1",
    });
    expect((await evidence.unclassified(company.companyId, job.id))?.id).toBe(first.id);
    expect(await evidence.countForJob(company.companyId, job.id)).toBe(2);
    const results = await evidence.results(company.companyId, document.id);
    expect(results.map((result) => [result.attemptId, result.outcome])).toEqual([
      [second.id, "UNKNOWN"],
    ]);
    expect(await evidence.unclassified(company.companyId, "otro-job")).toBeNull();
  });

  it("el XML autorizado es un artefacto aparte, con su propio hash", async () => {
    const prisma = db.database.prisma;
    const authorized = await insertDocument(prisma, company, "AUTHORIZED");
    const artifacts = createArtifactStore(prisma);
    const content = Buffer.from(`<autorizado>${authorized.accessKey}</autorizado>`);
    const saved = await artifacts.save({
      companyId: company.companyId,
      documentId: authorized.id,
      kind: "AUTHORIZED_XML",
      mediaType: "application/xml",
      content,
      metadata: { sriAttemptId: null },
    });
    const signed = await artifacts.summary(company.companyId, authorized.id, "SIGNED_XML");
    expect(saved.sha256).toBe(sha256(content));
    expect(saved.sha256).not.toBe(signed!.sha256);
    expect(
      (await artifacts.read(company.companyId, authorized.id, "AUTHORIZED_XML"))!.content.equals(
        content,
      ),
    ).toBe(true);
  });
});

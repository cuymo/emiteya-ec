// Contrato de regresión de la factura (add-credit-notes, tarea 1.1, design D2): antes de compartir la
// reserva y la firma con la nota de crédito, se fija lo que la factura produce para entradas
// deterministas (fecha, código numérico, empresa y borrador fijos): la reserva y su número, la
// clave, el snapshot, el XML byte a byte, el XML firmado (que solo agrega la firma), los metadatos
// y el hash del artefacto respecto de sus bytes, las transiciones, la auditoría, la idempotencia y
// los errores. Los fixtures se generaron con el código anterior al refactor; para regenerarlos a
// propósito: `INVOICE_REGRESSION_UPDATE=1`.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { InvoiceView } from "@facturador/contracts";
import {
  fiscalCatalogQueries,
  loadInstalledFiscalCatalogs,
} from "../../src/modules/catalogs/infrastructure/index.ts";
import type { InvoiceSnapshot } from "../../src/modules/invoices/domain/snapshot.ts";
import { toXmlSnapshot } from "../../src/modules/invoices/application/xml-snapshot.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { registeredSchema } from "../../src/modules/sri-engine/application/schemas.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { XML_SIGNER_VERSION } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import { createInvoiceXmlBuilder } from "../../src/modules/sri-engine/infrastructure/invoice-xml-builder.ts";
import {
  readEnvelopedSignature,
  verifyEnvelopedSignature,
} from "../../src/modules/sri-engine/infrastructure/signature-inspection.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp, testXsdValidator } from "./taxpayer-harness.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/invoice-regression/", import.meta.url));
const UPDATE = process.env.INVOICE_REGRESSION_UPDATE === "1";
const NOW = new Date("2026-10-05T15:00:00.000Z");
const IDEMPOTENCY_KEY = "regresion-factura-0001";
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

type Body = { data: InvoiceView & { version: number }; error: { code: string } };
const bodyOf = (res: { body: unknown }) => res.body as Body;

/** Los identificadores cambian en cada esquema: el contrato los reemplaza por su rol. */
function normalized(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      "<id>",
    ),
  );
}

/** Compara con el fixture, o lo escribe cuando se regenera a propósito. */
function matchesFixture(name: string, actual: string) {
  const path = `${FIXTURES}${name}`;
  if (UPDATE || !existsSync(path)) {
    expect(UPDATE, `falta el fixture ${name}: generarlo con INVOICE_REGRESSION_UPDATE=1`).toBe(
      true,
    );
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  expect(actual).toBe(readFileSync(path, "utf8"));
}

describe("contrato de regresión de la factura", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  const xsd = testXsdValidator();
  // El código numérico fijo hace determinista la clave; su composición es la real.
  const realKeys = createAccessKeys();
  const accessKeys = { ...realKeys, numericCode: () => "12345678" };

  const draft = async (quantity = "3") => {
    const res = await request(api.app)
      .post("/api/v1/invoices/drafts")
      .set("Cookie", a.cookies.operator)
      .send({
        emissionPointId: a.emissionPointId,
        buyerPartyId: a.customerId,
        lines: [{ productId: a.productId, quantity, discount: "1.25" }],
        payments: [{ paymentMethod: "01" }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (body: object, key: string | null = IDEMPOTENCY_KEY) => {
    const req = request(api.app).post("/api/v1/invoices").set("Cookie", a.cookies.operator);
    return (key === null ? req : req.set("Idempotency-Key", key)).send(body);
  };

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_regression_contract");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      invoices: { accessKeys, now: () => NOW },
    });
    a = await readyCompany(api, db, { slug: "regresion", pool, p12Dir: inject("p12FixturesDir") });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("la factura produce la misma reserva, clave, snapshot, XML, firma, transiciones, auditoría e idempotencia", async () => {
    const prisma = db.database.prisma;
    const first = await draft();
    const res = await emit({ draftId: first.id, expectedVersion: first.version });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const invoice = bodyOf(res).data;
    const document = await prisma.electronicDocument.findUniqueOrThrow({
      where: { id: invoice.id },
    });

    // Reserva y clave.
    matchesFixture(
      "document.json",
      `${JSON.stringify(
        {
          documentType: document.documentType,
          state: document.state,
          documentNumber: document.documentNumber,
          sequential: document.sequential,
          accessKey: document.accessKey,
          numericCode: document.numericCode,
          issueDate: document.issueDate.toISOString().slice(0, 10),
          schemaVersion: document.schemaVersion,
          buyerIdentification: document.buyerIdentification,
          buyerName: document.buyerName,
          total: document.total.toFixed(),
        },
        null,
        2,
      )}\n`,
    );
    // Snapshot completo, con los identificadores por su rol.
    matchesFixture("snapshot.json", `${JSON.stringify(normalized(document.snapshot), null, 2)}\n`);
    // XML sin firmar, byte a byte, desde el snapshot.
    const unsigned = createInvoiceXmlBuilder().build(
      toXmlSnapshot(document.snapshot as unknown as InvoiceSnapshot),
    );
    matchesFixture("unsigned.xml", unsigned);

    // XML firmado: el mismo XML con la firma agregada, que valida, verifica y declara sus metadatos.
    const artifact = await prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: invoice.id, kind: "SIGNED_XML" },
    });
    const content = Buffer.from(artifact.content);
    const signed = content.toString("utf8");
    expect(signed.replace(/<ds:Signature\b[\s\S]*<\/ds:Signature>/, "")).toBe(unsigned);
    expect([artifact.sha256, artifact.sizeBytes]).toEqual([sha256(content), content.length]);
    const registry = await fiscalCatalogQueries(prisma).schemaRegistry();
    const schema = registeredSchema(registry, "01", "1.1.0")!;
    expect(await xsd.validate(signed, schema)).toEqual({ valid: true });
    const signature = readEnvelopedSignature(signed);
    const publicKey = signature.certificate.publicKey.export({ type: "spki", format: "pem" });
    expect(verifyEnvelopedSignature(signature, publicKey as string)).toBe(true);
    const certificate = await prisma.signingCertificate.findFirstOrThrow({
      where: { activeCompanyId: a.companyId },
    });
    expect(artifact.metadata).toEqual({
      documentType: "01",
      schemaVersion: "1.1.0",
      schemaPath: "sri-xsd/factura_V1.1.0.xsd",
      schemaSha256: schema.sha256,
      imports: [{ path: "w3c-xsd/xmldsig-core-schema.xsd", sha256: schema.imports[0]!.sha256 }],
      builderVersion: "1",
      signerVersion: XML_SIGNER_VERSION,
      certificateFingerprint: certificate.fingerprintSha256,
    });

    // Transiciones, auditoría y transmisión programada.
    const transitions = await prisma.documentStateTransition.findMany({
      where: { documentId: invoice.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(transitions.map((t) => [t.fromState, t.toState, t.cause, t.actorUserId])).toEqual([
      [null, "RESERVED", "EMISSION", a.operatorId],
      ["RESERVED", "SIGNED", "SIGNING", a.operatorId],
    ]);
    expect(transitions[0]!.metadata).toMatchObject({ reservationId: document.reservationId });
    expect(transitions[1]!.metadata).toMatchObject({ artifactSha256: artifact.sha256 });
    const events = await prisma.auditEvent.findMany({
      where: { companyId: a.companyId, action: { startsWith: "invoice." } },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((event) => [event.action, event.actorUserId, event.changes])).toEqual([
      [
        "invoice.reserved",
        a.operatorId,
        {
          invoiceId: invoice.id,
          documentNumber: document.documentNumber,
          accessKey: document.accessKey,
          environment: document.environment,
          total: document.total.toFixed(),
        },
      ],
      [
        "invoice.signed",
        a.operatorId,
        {
          invoiceId: invoice.id,
          documentNumber: document.documentNumber,
          artifactSha256: artifact.sha256,
        },
      ],
    ]);
    expect(
      await prisma.job.count({ where: { documentId: invoice.id, type: "sri.transmit" } }),
    ).toBe(1);

    // Idempotencia: la misma solicitud repite, otra es un conflicto, sin clave se rechaza.
    const replay = await emit({ draftId: first.id, expectedVersion: first.version });
    expect([replay.status, bodyOf(replay).data.id]).toEqual([200, invoice.id]);
    const other = await draft("1");
    const reused = await emit({ draftId: other.id, expectedVersion: other.version });
    expect([reused.status, bodyOf(reused).error.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    const missing = await emit({ draftId: other.id, expectedVersion: other.version }, null);
    expect([missing.status, bodyOf(missing).error.code]).toEqual([400, "IDEMPOTENCY_KEY_REQUIRED"]);
    // Errores: versión vencida del borrador y borrador ya emitido.
    const stale = await emit(
      { draftId: other.id, expectedVersion: other.version + 1 },
      "regresion-2",
    );
    expect([stale.status, bodyOf(stale).error.code]).toEqual([409, "INVOICE_DRAFT_CHANGED"]);
    const emitted = await emit(
      { draftId: first.id, expectedVersion: first.version },
      "regresion-3",
    );
    expect([emitted.status, bodyOf(emitted).error.code]).toEqual([
      409,
      "INVOICE_DRAFT_ALREADY_EMITTED",
    ]);
    // La siguiente factura del punto recibe el número siguiente.
    const next = await emit({ draftId: other.id, expectedVersion: other.version }, "regresion-4");
    expect(bodyOf(next).data.documentNumber).toBe("001-001-000000002");
  });
});

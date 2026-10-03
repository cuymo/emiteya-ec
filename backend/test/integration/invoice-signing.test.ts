// Del snapshot al artefacto firmado (add-invoice-emission, tarea 9.1, design D9) contra PostgreSQL
// y el pool criptográfico reales: el artefacto exacto con su SHA-256, tamaño, tipo y metadatos, el
// XML firmado que vuelve a validar y verifica, SIGNED solo con su artefacto, y el XML construido
// solo desde el snapshot aunque cambien el producto o la empresa.
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { InvoiceView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { XML_SIGNER_VERSION } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import {
  readEnvelopedSignature,
  verifyEnvelopedSignature,
} from "../../src/modules/sri-engine/infrastructure/signature-inspection.ts";
import { registeredSchema } from "../../src/modules/sri-engine/application/schemas.ts";
import { fiscalCatalogQueries } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createTaxpayerScope } from "../../src/modules/taxpayer/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import {
  CUSTODY,
  createProduct,
  profileOf,
  readyCompany,
  type ReadyCompany,
} from "./emission-harness.ts";
import { buildTaxpayerApp, testXsdValidator } from "./taxpayer-harness.ts";

type Body = {
  data: InvoiceView & { id: string; version: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("firma de la factura hasta SIGNED con su artefacto exacto", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let crashing: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  const xsd = testXsdValidator();

  async function draftFor(company: ReadyCompany, overrides: Record<string, unknown> = {}) {
    const res = await request(api.app)
      .post("/api/v1/invoices/drafts")
      .set("Cookie", company.cookies.admin)
      .send({
        emissionPointId: company.emissionPointId,
        buyerPartyId: company.customerId,
        lines: [{ productId: company.productId, quantity: "3", discount: "1.25" }],
        payments: [{ paymentMethod: "01" }],
        ...overrides,
      });
    expect(res.status).toBe(201);
    return bodyOf(res).data;
  }
  const emit = (draft: { id: string; version: number }, app = api.app, who = a.cookies.admin) =>
    request(app)
      .post("/api/v1/invoices")
      .set("Cookie", who)
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: draft.id, expectedVersion: draft.version });
  const retry = (invoiceId: string) =>
    request(api.app)
      .post(`/api/v1/invoices/${invoiceId}/signing-attempts`)
      .set("Cookie", a.cookies.operator);
  const artifactOf = (documentId: string) =>
    db.database.prisma.documentArtifact.findFirstOrThrow({ where: { documentId } });

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_signing");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY } });
    crashing = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      invoices: { signAfterReserve: false },
    });
    a = await readyCompany(api, db, { slug: "a", pool, p12Dir: inject("p12FixturesDir") });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("emite hasta SIGNED con un artefacto cuyo SHA-256 y tamaño son los de sus bytes exactos", async () => {
    const res = await emit(await draftFor(a), api.app, a.cookies.operator);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const invoice = bodyOf(res).data;
    expect(invoice).toMatchObject({ state: "SIGNED", diagnostic: null });
    expect(invoice.signedAt).not.toBeNull();

    const artifact = await artifactOf(invoice.id);
    const content = Buffer.from(artifact.content);
    expect(artifact).toMatchObject({
      kind: "SIGNED_XML",
      mediaType: "application/xml",
      sizeBytes: content.length,
      sha256: sha256(content),
    });
    expect(invoice.artifact).toEqual({ sha256: artifact.sha256, sizeBytes: artifact.sizeBytes });
    const certificate = await db.database.prisma.signingCertificate.findFirstOrThrow({
      where: { activeCompanyId: a.companyId },
    });
    const registry = await fiscalCatalogQueries(db.database.prisma).schemaRegistry();
    const schema = registeredSchema(registry, "01", "1.1.0")!;
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
  });

  it("el XML firmado vuelve a validar contra el XSD, verifica y lleva la clave y la firma vigente", async () => {
    const invoice = bodyOf(await emit(await draftFor(a))).data;
    const xml = Buffer.from((await artifactOf(invoice.id)).content).toString("utf8");
    const registry = await fiscalCatalogQueries(db.database.prisma).schemaRegistry();
    expect(await xsd.validate(xml, registeredSchema(registry, "01", "1.1.0")!)).toEqual({
      valid: true,
    });
    expect(xml).toContain(`<claveAcceso>${invoice.accessKey}</claveAcceso>`);
    const signature = readEnvelopedSignature(xml);
    const publicKey = signature.certificate.publicKey.export({ type: "spki", format: "pem" });
    expect(verifyEnvelopedSignature(signature, publicKey as string)).toBe(true);
    const certificate = await db.database.prisma.signingCertificate.findFirstOrThrow({
      where: { activeCompanyId: a.companyId },
    });
    expect(signature.certificate.fingerprint256.replaceAll(":", "").toLowerCase()).toBe(
      certificate.fingerprintSha256,
    );
  });

  it("registra el paso a SIGNED y el evento con el SHA-256 del artefacto, sin XML", async () => {
    const invoice = bodyOf(await emit(await draftFor(a), api.app, a.cookies.operator)).data;
    const prisma = db.database.prisma;
    const transitions = await prisma.documentStateTransition.findMany({
      where: { documentId: invoice.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(transitions.map((t) => [t.fromState, t.toState, t.cause, t.actorUserId])).toEqual([
      [null, "RESERVED", "EMISSION", a.operatorId],
      ["RESERVED", "SIGNED", "SIGNING", a.operatorId],
    ]);
    const events = await prisma.auditEvent.findMany({
      where: { companyId: a.companyId, action: { startsWith: "invoice." } },
    });
    const signed = events.find(
      (event) =>
        event.action === "invoice.signed" &&
        (event.changes as { invoiceId?: string }).invoiceId === invoice.id,
    );
    expect(signed).toMatchObject({ actorUserId: a.operatorId });
    expect(signed?.changes).toEqual({
      invoiceId: invoice.id,
      documentNumber: invoice.documentNumber,
      artifactSha256: invoice.artifact?.sha256,
    });
    expect(JSON.stringify(events)).not.toMatch(/<factura|<\?xml|ds:Signature/);
  });

  it("el XML se construye solo desde el snapshot aunque cambien el producto o la empresa", async () => {
    const productId = await createProduct(db, a, { unitPrice: "10", name: "Varilla" });
    const reserved = bodyOf(
      await emit(await draftFor(a, { lines: [{ productId, quantity: "1" }] }), crashing.app),
    ).data;
    expect(reserved.state).toBe("RESERVED");
    const prisma = db.database.prisma;
    await prisma.product.update({ where: { id: productId }, data: { unitPrice: "99" } });
    const scope = createTaxpayerScope(prisma);
    const current = (await scope.configs.findCurrent(a.companyId))!;
    await scope.configs.appendVersion(a.companyId, {
      version: current.version + 1,
      config: {
        profile: profileOf({ headOfficeAddress: "Dirección corregida" }),
        environment: "TEST",
        logo: null,
      },
      createdBy: a.adminId,
    });
    const res = await retry(reserved.id);
    expect(bodyOf(res).data).toMatchObject({
      state: "SIGNED",
      documentNumber: reserved.documentNumber,
      accessKey: reserved.accessKey,
    });
    const xml = Buffer.from((await artifactOf(reserved.id)).content).toString("utf8");
    expect(xml).toContain("<precioUnitario>10</precioUnitario>");
    expect(xml).toContain("<dirMatriz>Av. Amazonas N24-03, Quito</dirMatriz>");
    expect(xml).not.toContain("Dirección corregida");
  });

  it("un comprobante no queda SIGNED sin su artefacto", async () => {
    const reserved = bodyOf(await emit(await draftFor(a), crashing.app)).data;
    const prisma = db.database.prisma;
    await expect(
      prisma.$transaction((tx) =>
        createDocumentRepository(tx).markSigned(a.companyId, reserved.id, new Date()),
      ),
    ).rejects.toThrow(/firmado sin su artefacto/);
    const document = await prisma.electronicDocument.findUniqueOrThrow({
      where: { id: reserved.id },
    });
    expect(document.state).toBe("RESERVED");
    expect(await prisma.documentArtifact.count({ where: { documentId: reserved.id } })).toBe(0);
  });
});

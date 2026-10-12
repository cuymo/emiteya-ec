// Recuperación de una factura reservada (add-invoice-emission, tarea 9.2, design D9 y D10) con
// fallos inyectados en cada etapa: el comprobante sigue RESERVED con el diagnóstico del último
// intento y un reintento autorizado lo lleva a SIGNED con su mismo número y su misma clave, sin
// reservar otro. Sin reintentos automáticos y sin secretos ni XML en el diagnóstico.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { InvoiceView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import {
  certificateTasksEntry,
  signingModule,
} from "../../src/modules/signing/infrastructure/index.ts";
import { XsdValidatorError } from "../../src/modules/sri-engine/application/ports.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { FIXTURE_PASSWORD, readFixture } from "../support/p12-fixtures.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { buildTaxpayerApp, testXsdValidator } from "./taxpayer-harness.ts";

type Body = {
  data: InvoiceView & { id: string; version: number };
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
type App = ReturnType<typeof buildTaxpayerApp>;

describe("recuperación de una factura reservada", () => {
  let db: MigratedSchema;
  const apps: Record<
    "ok" | "crashing" | "busyXsd" | "busyCrypto" | "expired" | "brokenSchema",
    App
  > = {} as never;
  let a: ReadyCompany;
  let b: ReadyCompany;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  const p12Dir = inject("p12FixturesDir");
  const brokenRoot = mkdtempSync(join(tmpdir(), "facturador-recovery-xsd-"));

  const signingFor = (now?: () => Date) =>
    signingModule({
      prisma: db.database.prisma,
      authorizer: createAuthorizer({
        memberships: createMembershipReader(db.database.prisma),
        securityEvents: { emit: () => undefined },
      }),
      custody: CUSTODY,
      maxBytes: 64 * 1024,
      pool,
      ...(now ? { now } : {}),
    });
  async function draftFor(company: ReadyCompany) {
    const res = await request(apps.ok.app)
      .post("/api/v1/invoices/drafts")
      .set("Cookie", company.cookies.admin)
      .send({
        emissionPointId: company.emissionPointId,
        buyerPartyId: company.customerId,
        lines: [{ productId: company.productId, quantity: "3", discount: "1.25" }],
        payments: [{ paymentMethod: "01" }],
      });
    expect(res.status).toBe(201);
    return bodyOf(res).data;
  }
  async function emitWith(app: App, key = randomUUID(), company = a) {
    const draft = await draftFor(company);
    const res = await request(app.app)
      .post("/api/v1/invoices")
      .set("Cookie", company.cookies.operator)
      .set("Idempotency-Key", key)
      .send({ draftId: draft.id, expectedVersion: draft.version });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { invoice: bodyOf(res).data, draft, key };
  }
  const retry = (invoiceId: string, app: App = apps.ok, cookie = a.cookies.operator) =>
    request(app.app).post(`/api/v1/invoices/${invoiceId}/signing-attempts`).set("Cookie", cookie);
  const get = async (invoiceId: string) =>
    bodyOf(
      await request(apps.ok.app)
        .get(`/api/v1/invoices/${invoiceId}`)
        .set("Cookie", a.cookies.admin),
    ).data;
  const reservations = () =>
    db.database.prisma.fiscalSequenceReservation.count({ where: { companyId: a.companyId } });
  const retriedEvents = (invoiceId: string) =>
    db.database.prisma.auditEvent
      .findMany({ where: { companyId: a.companyId, action: "invoice.signing_retried" } })
      .then((events) =>
        events.filter((event) => (event.changes as { invoiceId?: string }).invoiceId === invoiceId),
      );

  beforeAll(async () => {
    db = await createMigratedSchema("invoice_recovery");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const signing = { pool, custody: CUSTODY };
    const xsd = testXsdValidator();
    const product = fileURLToPath(new URL("../../../docs/product/", import.meta.url));
    cpSync(join(product, "sri-xsd"), join(brokenRoot, "sri-xsd"), { recursive: true });
    cpSync(join(product, "w3c-xsd"), join(brokenRoot, "w3c-xsd"), { recursive: true });
    writeFileSync(join(brokenRoot, "sri-xsd", "factura_V1.1.0.xsd"), "<alterado/>");
    apps.ok = buildTaxpayerApp(db, { signing });
    apps.crashing = buildTaxpayerApp(db, { signing, invoices: { signAfterReserve: false } });
    apps.busyXsd = buildTaxpayerApp(db, {
      signing,
      invoices: {
        xsd: {
          ensureAvailable: (schema) => xsd.ensureAvailable(schema),
          validate: () => Promise.reject(new XsdValidatorError("VALIDATOR_BUSY")),
        },
      },
    });
    apps.busyCrypto = buildTaxpayerApp(db, {
      signing,
      invoices: {
        signer: {
          signDocument: () =>
            Promise.reject(Object.assign(new Error("saturado"), { code: "CRYPTO_BUSY" })),
        },
      },
    });
    apps.expired = buildTaxpayerApp(db, {
      signing,
      invoices: { signer: signingFor(() => new Date("2100-01-01T00:00:00Z")).documents },
    });
    apps.brokenSchema = buildTaxpayerApp(db, {
      signing,
      invoices: { xsd: createXmllintXsdValidator({ root: brokenRoot }) },
    });
    a = await readyCompany(apps.ok, db, { slug: "a", pool, p12Dir });
    b = await readyCompany(apps.ok, db, { slug: "b", pool, p12Dir });
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
    rmSync(brokenRoot, { recursive: true, force: true });
  });

  it("validación saturada: reservada con diagnóstico reintentable, y el reintento la firma", async () => {
    const { invoice } = await emitWith(apps.busyXsd);
    expect(invoice).toMatchObject({
      state: "RESERVED",
      diagnostic: {
        stage: "VALIDATE_XSD",
        code: "VALIDATOR_BUSY",
        class: "RETRYABLE_OPERATIONAL",
        attemptCount: 1,
      },
    });
    const before = await reservations();
    const res = await retry(invoice.id);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toMatchObject({
      state: "SIGNED",
      documentNumber: invoice.documentNumber,
      accessKey: invoice.accessKey,
      diagnostic: null,
    });
    expect(await reservations()).toBe(before);
    const retried = await retriedEvents(invoice.id);
    expect(retried.map((event) => [event.actorUserId, event.changes])).toEqual([
      [
        a.operatorId,
        { invoiceId: invoice.id, documentNumber: invoice.documentNumber, result: "SIGNED" },
      ],
    ]);
    // El reintento que completa la firma deja también el evento de firma, con el mismo actor.
    const signed = await db.database.prisma.auditEvent.findMany({
      where: { companyId: a.companyId, action: "invoice.signed" },
    });
    expect(
      signed
        .filter((event) => (event.changes as { invoiceId?: string }).invoiceId === invoice.id)
        .map((event) => event.actorUserId),
    ).toEqual([a.operatorId]);
  });

  it("servicio de firma ocupado: diagnóstico reintentable de la etapa de firma", async () => {
    const { invoice } = await emitWith(apps.busyCrypto);
    expect(invoice.diagnostic).toMatchObject({
      stage: "SIGN",
      code: "CRYPTO_BUSY",
      class: "RETRYABLE_OPERATIONAL",
    });
    const before = await reservations();
    expect(bodyOf(await retry(invoice.id)).data).toMatchObject({
      state: "SIGNED",
      documentNumber: invoice.documentNumber,
      accessKey: invoice.accessKey,
    });
    expect(await reservations()).toBe(before);
  });

  it("firma que deja de ser utilizable: diagnóstico determinista y, tras cargar otra, el reintento firma", async () => {
    const { invoice } = await emitWith(apps.expired);
    expect(invoice.diagnostic).toMatchObject({
      stage: "SIGN",
      code: "SIGNING_CERTIFICATE_NOT_USABLE",
      class: "DETERMINISTIC_CONFIGURATION",
    });
    // Sin reintentos automáticos: el diagnóstico queda visible hasta un reintento autorizado.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await get(invoice.id)).diagnostic?.attemptCount).toBe(1);
    const current = await db.database.prisma.signingCertificate.findFirstOrThrow({
      where: { activeCompanyId: a.companyId },
    });
    const replaced = await signingFor().service.upload(
      { userId: a.adminId, companyId: a.companyId, role: "ADMIN", requestId: randomUUID() },
      {
        file: readFixture(p12Dir, "sd-printable.modern.p12").toString("base64"),
        password: FIXTURE_PASSWORD,
        expectedCurrentId: current.id,
      },
    );
    const before = await reservations();
    const res = await retry(invoice.id);
    expect(bodyOf(res).data).toMatchObject({
      state: "SIGNED",
      documentNumber: invoice.documentNumber,
    });
    expect(await reservations()).toBe(before);
    const artifact = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: invoice.id },
    });
    expect((artifact.metadata as { certificateFingerprint: string }).certificateFingerprint).toBe(
      replaced.entry.certificate.fingerprint,
    );
  });

  it("esquema alterado en la instalación: diagnóstico de configuración, y con el paquete íntegro firma", async () => {
    const { invoice } = await emitWith(apps.crashing);
    const res = await retry(invoice.id, apps.brokenSchema);
    expect(bodyOf(res).data.diagnostic).toMatchObject({
      stage: "VALIDATE_XSD",
      code: "SCHEMA_HASH_MISMATCH",
      class: "DETERMINISTIC_CONFIGURATION",
    });
    expect(bodyOf(await retry(invoice.id)).data.state).toBe("SIGNED");
  });

  it("caída tras la reserva: la repetición con la misma clave la retoma hasta la firma", async () => {
    const { invoice, draft, key } = await emitWith(apps.crashing);
    expect(invoice).toMatchObject({ state: "RESERVED", diagnostic: null });
    const before = await reservations();
    const replay = await request(apps.ok.app)
      .post("/api/v1/invoices")
      .set("Cookie", a.cookies.operator)
      .set("Idempotency-Key", key)
      .send({ draftId: draft.id, expectedVersion: draft.version });
    expect(replay.status).toBe(200);
    expect(bodyOf(replay).data).toMatchObject({
      id: invoice.id,
      state: "SIGNED",
      documentNumber: invoice.documentNumber,
      accessKey: invoice.accessKey,
    });
    expect(await reservations()).toBe(before);
  });

  it("un intento interrumpido con el arriendo vigente no se repite hasta que vence", async () => {
    const { invoice } = await emitWith(apps.crashing);
    const prisma = db.database.prisma;
    await prisma.electronicDocument.update({
      where: { id: invoice.id },
      data: { attemptLeaseUntil: new Date(Date.now() + 120_000) },
    });
    const blocked = bodyOf(await retry(invoice.id)).data;
    expect(blocked).toMatchObject({ state: "RESERVED", diagnostic: null });
    // Con otro intento en curso no empieza ninguno: no hay evento del reintento.
    expect(await retriedEvents(invoice.id)).toEqual([]);
    await prisma.electronicDocument.update({
      where: { id: invoice.id },
      data: { attemptLeaseUntil: new Date(Date.now() - 1_000) },
    });
    expect(bodyOf(await retry(invoice.id)).data.state).toBe("SIGNED");
    expect((await retriedEvents(invoice.id)).map((event) => event.changes)).toEqual([
      { invoiceId: invoice.id, documentNumber: invoice.documentNumber, result: "SIGNED" },
    ]);
  });

  it("dos reintentos simultáneos dejan la factura firmada una sola vez, con un solo artefacto", async () => {
    const { invoice } = await emitWith(apps.crashing);
    const responses = await Promise.all([retry(invoice.id), retry(invoice.id)]);
    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    const prisma = db.database.prisma;
    expect(await prisma.documentArtifact.count({ where: { documentId: invoice.id } })).toBe(1);
    expect(
      await prisma.documentStateTransition.count({
        where: { documentId: invoice.id, toState: "SIGNED" },
      }),
    ).toBe(1);
    expect((await get(invoice.id)).state).toBe("SIGNED");
    // Solo el reintento que tomó el arriendo inició un intento y se audita.
    expect((await retriedEvents(invoice.id)).map((event) => event.changes)).toEqual([
      { invoiceId: invoice.id, documentNumber: invoice.documentNumber, result: "SIGNED" },
    ]);
  });

  it("reintentar una factura firmada no tiene efecto ni se audita", async () => {
    const { invoice } = await emitWith(apps.ok);
    expect(invoice.state).toBe("SIGNED");
    const res = await retry(invoice.id);
    expect(res.status).toBe(200);
    expect(bodyOf(res).data).toEqual(invoice);
    expect(
      await db.database.prisma.documentArtifact.count({ where: { documentId: invoice.id } }),
    ).toBe(1);
    expect(await retriedEvents(invoice.id)).toEqual([]);
  });

  it("el diagnóstico no lleva secretos, el XML ni datos del comprador", async () => {
    const { invoice } = await emitWith(apps.expired);
    const view = await get(invoice.id);
    const row = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const text = JSON.stringify([
      view.diagnostic,
      row.lastAttemptStage,
      row.lastAttemptCode,
      row.lastAttemptClass,
      row.lastAttemptDetail,
    ]);
    for (const forbidden of [FIXTURE_PASSWORD, "<", "EL PERNO", "-----BEGIN"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("una factura de otra empresa no existe para reintentarla", async () => {
    const { invoice } = await emitWith(apps.crashing);
    const res = await retry(invoice.id, apps.ok, b.cookies.admin);
    expect(res.status).toBe(404);
    expect(bodyOf(res).error.code).toBe("INVOICE_NOT_FOUND");
    expect((await get(invoice.id)).state).toBe("RESERVED");
    // Rechazado antes de iniciar un intento: ningún evento, en ninguna de las dos empresas.
    expect(await retriedEvents(invoice.id)).toEqual([]);
    expect(
      await db.database.prisma.auditEvent.count({
        where: { companyId: b.companyId, action: { startsWith: "invoice." } },
      }),
    ).toBe(0);
  });
});

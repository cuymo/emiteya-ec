// Invariantes de la migración add_email_delivery en PostgreSQL (design D2, D6 y D8): una sola
// configuración por empresa con valores válidos, el sobre de la contraseña con su forma, un solo
// envío automático por comprobante, el reenvío con su actor y su clave única por empresa, estados
// coherentes y los intentos de solo agregado.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

const FINGERPRINT = "a".repeat(64);

describe("entrega por correo en la base de datos", () => {
  let schema: MigratedSchema;
  let database: Database;
  let companyA: FiscalCompany;
  let companyB: FiscalCompany;
  let document: TestDocument;

  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );
  const settings = (company: FiscalCompany, data: Record<string, unknown> = {}) => ({
    companyId: company.companyId,
    host: "smtp.empresa.ec",
    port: 465,
    security: "TLS",
    username: "facturas@empresa.ec",
    fromName: "Ferretería Andina",
    fromAddress: "facturas@empresa.ec",
    updatedBy: company.adminId,
    ...data,
  });
  const delivery = (data: Record<string, unknown> = {}) =>
    database.prisma.emailDelivery.create({
      data: {
        companyId: document.companyId,
        documentId: document.id,
        origin: "AUTOMATIC",
        environment: "TEST",
        status: "PENDING",
        ...data,
      },
    });
  const manual = (key: string, data: Record<string, unknown> = {}) =>
    delivery({
      origin: "MANUAL",
      requestedBy: companyA.adminId,
      idempotencyKey: key,
      requestFingerprint: FINGERPRINT,
      ...data,
    });

  beforeAll(async () => {
    schema = await createMigratedSchema("email_schema");
    database = schema.database;
    companyA = await insertFiscalCompany(database.prisma, "Correo A", 1);
    companyB = await insertFiscalCompany(database.prisma, "Correo B", 1);
    document = await insertDocument(database.prisma, companyA, "AUTHORIZED");
  });

  afterAll(async () => {
    await schema?.drop();
  });

  it("una configuración por empresa, con puerto, seguridad, textos y direcciones válidos", async () => {
    await database.prisma.emailSettings.create({ data: settings(companyA) });
    expect(await fails(database.prisma.emailSettings.create({ data: settings(companyA) }))).toMatch(
      /Unique|unique|P2002/,
    );
    for (const invalid of [
      { port: 0 },
      { port: 65536 },
      { security: "SSL" },
      { host: "smtp empresa.ec" },
      { username: "" },
      { fromName: "Andina\r\nBcc: otro@x.ec" },
      { fromAddress: "no-es-correo" },
      { bccAddress: "a b@x.ec" },
      { testRecipient: "sin-arroba" },
    ]) {
      expect(
        await fails(database.prisma.emailSettings.create({ data: settings(companyB, invalid) })),
        JSON.stringify(invalid),
      ).toContain("email_settings_values_check");
    }
    await database.prisma.emailSettings.create({
      data: settings(companyB, { username: null, security: "NONE", port: 1025 }),
    });
  });

  it("el sobre de la contraseña tiene su forma, y se borra con su configuración", async () => {
    const secret = (data: Record<string, unknown> = {}) => ({
      companyId: companyA.companyId,
      formatVersion: 1,
      keyVersion: "1",
      keyCheck: new Uint8Array(32),
      wrappedKey: new Uint8Array(48),
      wrappedKeyNonce: new Uint8Array(12),
      passwordCiphertext: new Uint8Array(20),
      passwordNonce: new Uint8Array(12),
      ...data,
    });
    expect(
      await fails(
        database.prisma.emailSettingsSecret.create({ data: secret({ formatVersion: 2 }) }),
      ),
    ).toContain("email_settings_secret_values_check");
    expect(
      await fails(
        database.prisma.emailSettingsSecret.create({
          data: secret({ passwordNonce: new Uint8Array(8) }),
        }),
      ),
    ).toContain("email_settings_secret_values_check");
    await database.prisma.emailSettingsSecret.create({ data: secret() });
    await database.prisma.emailSettings.delete({ where: { companyId: companyA.companyId } });
    expect(
      await database.prisma.emailSettingsSecret.count({
        where: { companyId: companyA.companyId },
      }),
    ).toBe(0);
  });

  it("un solo envío automático por comprobante", async () => {
    await delivery();
    expect(await fails(delivery())).toContain("email_delivery_automatic_document_key");
  });

  it("el reenvío exige actor, clave y huella; el automático no los admite", async () => {
    expect(await fails(delivery({ origin: "MANUAL" }))).toContain("email_delivery_values_check");
    expect(await fails(manual("clave con espacio"))).toContain("email_delivery_values_check");
    expect(await fails(manual("clave-1", { requestFingerprint: "corta" }))).toContain(
      "email_delivery_values_check",
    );
    expect(await fails(delivery({ requestedBy: companyA.adminId }))).toContain(
      "email_delivery_values_check",
    );
    await manual("clave-1");
    await manual("clave-2");
  });

  it("la clave de un reenvío es única por empresa", async () => {
    expect(await fails(manual("clave-1"))).toMatch(/Unique|unique|P2002/);
  });

  it("los estados son coherentes con sus momentos y su motivo", async () => {
    for (const invalid of [
      { status: "DELIVERED" },
      { status: "SENT" },
      { status: "SENT", sentAt: new Date() },
      { status: "FAILED", finishedAt: new Date() },
      { status: "PENDING", finishedAt: new Date() },
      { environment: "PRUEBAS" },
      { recipients: { address: "a@b.ec" } },
      { attemptCount: -1 },
    ]) {
      expect(
        await fails(manual(`estado-${Math.random()}`, invalid)),
        JSON.stringify(invalid),
      ).toContain("email_delivery_values_check");
    }
    const now = new Date();
    await manual("enviado", {
      status: "SENT",
      sentAt: now,
      finishedAt: now,
      recipients: [{ address: "a@b.ec", outcome: "ACCEPTED", reason: null }],
    });
    await manual("sin-destinatario", {
      status: "NO_RECIPIENT",
      failureCode: "NO_ADDRESS",
      finishedAt: now,
    });
  });

  it("los intentos son de solo agregado y numerados desde 1", async () => {
    const sent = await manual("con-intentos");
    expect(
      await fails(
        database.prisma.emailDeliveryAttempt.create({
          data: { deliveryId: sent.id, number: 0, outcome: "SENT" },
        }),
      ),
    ).toContain("email_delivery_attempt_values_check");
    expect(
      await fails(
        database.prisma.emailDeliveryAttempt.create({
          data: { deliveryId: sent.id, number: 1, outcome: "DELIVERED" },
        }),
      ),
    ).toContain("email_delivery_attempt_values_check");
    const attempt = await database.prisma.emailDeliveryAttempt.create({
      data: { deliveryId: sent.id, number: 1, outcome: "RETRYABLE", smtpCode: 421 },
    });
    expect(
      await fails(
        database.prisma.emailDeliveryAttempt.update({
          where: { id: attempt.id },
          data: { outcome: "SENT" },
        }),
      ),
    ).toContain("no admite");
    expect(
      await fails(database.prisma.emailDeliveryAttempt.delete({ where: { id: attempt.id } })),
    ).toContain("no admite");
  });

  it("un envío pertenece a la empresa de su comprobante", async () => {
    expect(await fails(delivery({ companyId: companyB.companyId, origin: "MANUAL" }))).not.toBe(
      null,
    );
    expect(
      await fails(
        manual("otra-empresa", { companyId: companyB.companyId, requestedBy: companyB.adminId }),
      ),
    ).toContain("email_delivery_company_id_document_id_fkey");
  });
});

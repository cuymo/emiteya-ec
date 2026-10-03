// Invariantes de la migración add_signing_certificate en PostgreSQL con dos empresas (design D2):
// una sola firma ACTIVE por empresa, claves compuestas por empresa, metadatos sin borrado y solo
// con la transición ACTIVE -> REPLACED, secreto sin actualización y solo para la firma ACTIVE, y
// anticipación entre 1 y 90. Escribe directamente en las tablas.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "../../src/platform/db/database.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

describe("invariantes de la firma electrónica en la base de datos", () => {
  let db: MigratedSchema;
  let prisma: DbClient;
  let companyA: string;
  let companyB: string;
  let userA: string;
  let userB: string;

  const metadata = (
    companyId: string,
    uploadedBy: string,
    overrides: Record<string, unknown> = {},
  ) => ({
    id: randomUUID(),
    companyId,
    status: "ACTIVE",
    activeCompanyId: companyId,
    subject: "CN=TITULAR",
    issuer: "CN=AC",
    serialNumber: "01",
    fingerprintSha256: randomBytes(32).toString("hex"),
    notBefore: new Date("2026-01-01T00:00:00Z"),
    notAfter: new Date("2027-01-01T00:00:00Z"),
    detectedRuc: "1790012345001",
    keyAlgorithm: "RSA",
    keyBits: 2048,
    uploadedBy,
    ...overrides,
  });
  const secret = (certificateId: string, companyId: string) => ({
    certificateId,
    companyId,
    formatVersion: 1,
    keyVersion: "1",
    keyCheck: randomBytes(32),
    wrappedKey: randomBytes(48),
    wrappedKeyNonce: randomBytes(12),
    p12Ciphertext: randomBytes(64),
    p12Nonce: randomBytes(12),
    passwordCiphertext: randomBytes(32),
    passwordNonce: randomBytes(12),
  });
  const table = (name: string) => `"${db.name}"."${name}"`;
  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => String(error),
    );

  beforeAll(async () => {
    db = await createMigratedSchema("signing_schema");
    prisma = db.database.prisma;
    companyA = await insertCompany(prisma, "Empresa A");
    companyB = await insertCompany(prisma, "Empresa B");
    userA = (await insertMember(prisma, companyA, { name: "Admin A", role: "ADMIN" })).userId;
    userB = (await insertMember(prisma, companyB, { name: "Admin B", role: "ADMIN" })).userId;
  });

  afterAll(async () => {
    await db.drop();
  });

  it("acepta una firma ACTIVE con su secreto y rechaza una segunda ACTIVE en la misma empresa", async () => {
    const first = await prisma.signingCertificate.create({ data: metadata(companyA, userA) });
    await prisma.signingCertificateSecret.create({ data: secret(first.id, companyA) });
    expect(
      await fails(prisma.signingCertificate.create({ data: metadata(companyA, userA) })),
    ).toMatch(/active_company_id/);
    // Otra empresa tiene su propia firma ACTIVE.
    await prisma.signingCertificate.create({ data: metadata(companyB, userB) });
  });

  it("el estado y active_company_id son coherentes", async () => {
    for (const overrides of [
      { activeCompanyId: null },
      { activeCompanyId: companyB },
      { status: "REPLACED", activeCompanyId: null, replacedAt: null },
      { status: "OTRO" },
    ]) {
      expect(
        await fails(
          prisma.signingCertificate.create({
            data: metadata(companyA, userA, { ...overrides, id: randomUUID() }),
          }),
        ),
        JSON.stringify(overrides),
      ).toMatch(/check|violates/i);
    }
  });

  it("rechaza claves no RSA o menores de 2048 bits, un RUC inválido y una vigencia invertida", async () => {
    for (const overrides of [
      { keyAlgorithm: "EC" },
      { keyBits: 1024 },
      { detectedRuc: "1790012345002" },
      { notAfter: new Date("2025-01-01T00:00:00Z") },
    ]) {
      expect(
        await fails(
          prisma.signingCertificate.create({
            data: metadata(companyA, userA, {
              ...overrides,
              status: "REPLACED",
              activeCompanyId: null,
              replacedAt: new Date(),
            }),
          }),
        ),
        JSON.stringify(overrides),
      ).toMatch(/check/i);
    }
  });

  it("rechaza un secreto o un reemplazo que apunta a otra empresa", async () => {
    const certificateA = await prisma.signingCertificate.findFirstOrThrow({
      where: { activeCompanyId: companyA },
    });
    expect(
      await fails(
        prisma.signingCertificateSecret.create({ data: secret(certificateA.id, companyB) }),
      ),
    ).toMatch(/foreign key|violates|active_only|solo una firma/i);
    const certificateB = await prisma.signingCertificate.findFirstOrThrow({
      where: { activeCompanyId: companyB },
    });
    expect(
      await fails(
        prisma.signingCertificate.update({
          where: { id: certificateA.id },
          data: {
            status: "REPLACED",
            activeCompanyId: null,
            replacedAt: new Date(),
            replacedById: certificateB.id,
          },
        }),
      ),
    ).toMatch(/foreign key|violates/i);
  });

  it("solo admite ACTIVE -> REPLACED y, una vez, el enlace a su reemplazo", async () => {
    const certificate = await prisma.signingCertificate.findFirstOrThrow({
      where: { activeCompanyId: companyA },
    });
    expect(
      await fails(
        prisma.signingCertificate.update({
          where: { id: certificate.id },
          data: { subject: "CN=OTRO" },
        }),
      ),
    ).toMatch(/ACTIVE a REPLACED/);
    // El reemplazo completo, como lo hará la aplicación (design D7).
    const next = await prisma.$transaction(async (tx) => {
      await tx.signingCertificateSecret.delete({ where: { certificateId: certificate.id } });
      await tx.signingCertificate.update({
        where: { id: certificate.id },
        data: { status: "REPLACED", activeCompanyId: null, replacedAt: new Date() },
      });
      const created = await tx.signingCertificate.create({ data: metadata(companyA, userA) });
      await tx.signingCertificate.update({
        where: { id: certificate.id },
        data: { replacedById: created.id },
      });
      return created;
    });
    expect(
      await prisma.signingCertificate.findUniqueOrThrow({ where: { id: certificate.id } }),
    ).toMatchObject({ status: "REPLACED", activeCompanyId: null, replacedById: next.id });
    expect(
      await fails(
        prisma.signingCertificate.update({
          where: { id: certificate.id },
          data: {
            status: "ACTIVE",
            activeCompanyId: companyA,
            replacedAt: null,
            replacedById: null,
          },
        }),
      ),
    ).toMatch(/ACTIVE a REPLACED/);
    expect(
      await fails(
        prisma.signingCertificate.update({
          where: { id: certificate.id },
          data: { replacedById: null },
        }),
      ),
    ).toMatch(/ACTIVE a REPLACED/);
  });

  it("los metadatos no se borran ni se truncan", async () => {
    const any = await prisma.signingCertificate.findFirstOrThrow({
      where: { companyId: companyA },
    });
    expect(await fails(prisma.signingCertificate.delete({ where: { id: any.id } }))).toMatch(
      /no admite DELETE/,
    );
    expect(
      await fails(prisma.$executeRawUnsafe(`TRUNCATE ${table("signing_certificate")} CASCADE`)),
    ).toMatch(/no admite TRUNCATE/);
  });

  it("el secreto no se actualiza, se puede borrar, y solo una firma ACTIVE tiene secreto", async () => {
    const active = await prisma.signingCertificate.findFirstOrThrow({
      where: { activeCompanyId: companyA },
    });
    await prisma.signingCertificateSecret.create({ data: secret(active.id, companyA) });
    expect(
      await fails(
        prisma.signingCertificateSecret.update({
          where: { certificateId: active.id },
          data: { keyVersion: "2" },
        }),
      ),
    ).toMatch(/no admite UPDATE/);
    await prisma.signingCertificateSecret.delete({ where: { certificateId: active.id } });
    const replaced = await prisma.signingCertificate.findFirstOrThrow({
      where: { companyId: companyA, status: "REPLACED" },
    });
    expect(
      await fails(prisma.signingCertificateSecret.create({ data: secret(replaced.id, companyA) })),
    ).toMatch(/solo una firma ACTIVE/);
  });

  it("la anticipación está entre 1 y 90 días", async () => {
    await prisma.signingCertificateSettings.create({
      data: { companyId: companyA, expiryAlertDays: 30 },
    });
    for (const expiryAlertDays of [0, 91]) {
      expect(
        await fails(
          prisma.signingCertificateSettings.update({
            where: { companyId: companyA },
            data: { expiryAlertDays },
          }),
        ),
      ).toMatch(/expiry_alert_days_check/);
    }
  });
});

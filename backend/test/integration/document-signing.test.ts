// Firma de comprobantes (add-invoice-emission, tarea 6.3, design D9 y D10): la firma vigente se lee
// con su secreto sellado, se abre con la custodia y firma en el pool criptográfico, que comprueba la
// huella del certificado embebido. P12 sintéticos; ningún secreto en errores ni en logs.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CertificateCustodyConfig } from "../../src/config/env.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import {
  DocumentSigningError,
  createDocumentSigning,
} from "../../src/modules/signing/application/document-signing.ts";
import {
  certificateTasksEntry,
  signingModule,
} from "../../src/modules/signing/infrastructure/index.ts";
import { createCertificateVault } from "../../src/modules/signing/infrastructure/custody/certificate-vault.ts";
import { createCertificateRepository } from "../../src/modules/signing/infrastructure/prisma-certificates.ts";
import { createXmlSigningTask } from "../../src/modules/signing/infrastructure/xml-signing-task.ts";
import { XML_SIGNER_VERSION } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import { createInvoiceXmlBuilder } from "../../src/modules/sri-engine/infrastructure/invoice-xml-builder.ts";
import {
  readEnvelopedSignature,
  verifyEnvelopedSignature,
} from "../../src/modules/sri-engine/infrastructure/signature-inspection.ts";
import {
  CryptoBusyError,
  CryptoPoolClosedError,
  CryptoTimeoutError,
  createCryptoWorkerPool,
} from "../../src/platform/workers/crypto-worker-pool.ts";
import { FIXTURE_PASSWORD, FIXTURE_RUC, readFixture } from "../support/p12-fixtures.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany, insertMember } from "./fixtures.ts";

const dir = inject("p12FixturesDir");
const custody = (fill: number): CertificateCustodyConfig => ({
  enabled: true,
  keyVersion: "1",
  key: Buffer.alloc(32, fill),
});
const XML = createInvoiceXmlBuilder().build({
  schemaVersion: "1.1.0",
  accessKey: "0310202601179001234500110010010000000011234567816",
  environment: "1",
  issueDate: "2026-10-03",
  sequential: "000000001",
  issuer: {
    ruc: FIXTURE_RUC,
    legalName: "COMERCIAL ANDINA S.A.",
    tradeName: null,
    headOfficeAddress: "Quito",
    establishment: "001",
    emissionPoint: "001",
    establishmentAddress: null,
    specialTaxpayerNumber: null,
    accountingRequired: false,
    withholdingAgentResolution: null,
    rimpe: false,
  },
  buyer: {
    identificationType: "07",
    identification: "9999999999999",
    legalName: "CONSUMIDOR FINAL",
    address: null,
  },
  lines: [
    {
      mainCode: null,
      auxiliaryCode: null,
      description: "Servicio",
      quantity: "1",
      unitPrice: "10",
      discount: "0.00",
      taxableBase: "10.00",
      taxes: [{ taxCode: "2", rateCode: "4", rate: "15", base: "10.00", amount: "1.50" }],
    },
  ],
  totals: {
    withoutTaxes: "10.00",
    discount: "0.00",
    taxes: [{ taxCode: "2", rateCode: "4", base: "10.00", amount: "1.50" }],
    total: "11.50",
  },
  payments: [{ method: "01", total: "11.50" }],
});

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) =>
      error instanceof DocumentSigningError ? error.code : `otro: ${String(error)}`,
  );

describe("firma de comprobantes con la firma vigente", () => {
  let db: MigratedSchema;
  const warnings: unknown[] = [];
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
    logger: { warn: (...args: unknown[]) => void warnings.push(args) },
  });
  let companyA: string;
  let companyB: string;
  let fingerprint: string;
  const moduleWith = (config: CertificateCustodyConfig | { enabled: false }, now?: () => Date) =>
    signingModule({
      prisma: db.database.prisma,
      authorizer: createAuthorizer({
        memberships: createMembershipReader(db.database.prisma),
        securityEvents: { emit: () => undefined },
      }),
      custody: config,
      maxBytes: 64 * 1024,
      pool,
      ...(now ? { now } : {}),
    });

  beforeAll(async () => {
    db = await createMigratedSchema("document_signing");
    const prisma = db.database.prisma;
    companyA = await insertCompany(prisma, "Empresa A");
    companyB = await insertCompany(prisma, "Empresa B");
    const admin = await insertMember(prisma, companyA, { name: "Admin", role: "ADMIN" });
    const { entry } = await moduleWith(custody(7)).service.upload(
      { userId: admin.userId, companyId: companyA, role: "ADMIN", requestId: randomUUID() },
      {
        file: readFixture(dir, "sd-utf8.modern.p12").toString("base64"),
        password: FIXTURE_PASSWORD,
        expectedCurrentId: null,
      },
    );
    fingerprint = entry.certificate.fingerprint;
  }, 120_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("firma un XML verificable con el certificado vigente y su huella", async () => {
    const signed = await moduleWith(custody(7)).documents.signDocument(companyA, XML, "01");
    expect(signed.certificateFingerprint).toBe(fingerprint);
    const signature = readEnvelopedSignature(signed.xml);
    expect(signature.certificate.fingerprint256.replaceAll(":", "").toLowerCase()).toBe(
      fingerprint,
    );
    const publicKey = signature.certificate.publicKey.export({ type: "spki", format: "pem" });
    expect(verifyEnvelopedSignature(signature, publicKey as string)).toBe(true);
    expect(signed.xml).toContain("<claveAcceso>0310202601179001234500110010010000000011234567816");
  });

  it("sin firma vigente o con la firma vencida no es utilizable", async () => {
    expect(await codeOf(moduleWith(custody(7)).documents.signDocument(companyB, XML, "01"))).toBe(
      "SIGNING_CERTIFICATE_NOT_USABLE",
    );
    const later = moduleWith(custody(7), () => new Date("2100-01-01T00:00:00Z"));
    expect(await codeOf(later.documents.signDocument(companyA, XML, "01"))).toBe(
      "SIGNING_CERTIFICATE_NOT_USABLE",
    );
  });

  it("con otra clave de custodia o sin custodia, la custodia no está disponible", async () => {
    expect(await codeOf(moduleWith(custody(8)).documents.signDocument(companyA, XML, "01"))).toBe(
      "CUSTODY_UNAVAILABLE",
    );
    expect(
      await codeOf(moduleWith({ enabled: false }).documents.signDocument(companyA, XML, "01")),
    ).toBe("CUSTODY_UNAVAILABLE");
  });

  it("si el certificado embebido no tiene la huella de la firma vigente, falla", async () => {
    const repository = createCertificateRepository(db.database.prisma);
    const signing = createDocumentSigning({
      certificates: {
        findActive: async (companyId) => {
          const active = await repository.findActive(companyId);
          return active && { ...active, fingerprint: "0".repeat(64) };
        },
        findSealedSecret: (companyId, id) => repository.findSealedSecret(companyId, id),
      },
      vault: createCertificateVault({
        activeVersion: "1",
        keys: new Map([["1", Buffer.alloc(32, 7)]]),
      }),
      task: createXmlSigningTask(pool),
    });
    expect(await codeOf(signing.signDocument(companyA, XML, "01"))).toBe("CERTIFICATE_MISMATCH");
  });

  it("traduce los fallos del pool a sus códigos", async () => {
    const repository = createCertificateRepository(db.database.prisma);
    const failing = (error: Error) =>
      createDocumentSigning({
        certificates: repository,
        vault: createCertificateVault({
          activeVersion: "1",
          keys: new Map([["1", Buffer.alloc(32, 7)]]),
        }),
        task: { sign: () => Promise.reject(error) },
      });
    for (const [error, code] of [
      [new CryptoBusyError(), "CRYPTO_BUSY"],
      [new CryptoTimeoutError(), "CRYPTO_TIMEOUT"],
      [new CryptoPoolClosedError(), "CRYPTO_UNAVAILABLE"],
      [new Error("worker"), "CRYPTO_UNAVAILABLE"],
    ] as const) {
      expect(await codeOf(failing(error).signDocument(companyA, XML, "01"))).toBe(code);
    }
  });

  it("ningún error ni log lleva la contraseña, la clave ni el XML", async () => {
    const errors: unknown[] = [];
    for (const signing of [moduleWith(custody(8)), moduleWith({ enabled: false })]) {
      await signing.documents.signDocument(companyA, XML, "01").catch((e) => errors.push(e));
    }
    const text = JSON.stringify([errors.map((e) => [String(e), (e as Error).message]), warnings]);
    for (const secret of [
      FIXTURE_PASSWORD,
      "COMERCIAL ANDINA",
      Buffer.alloc(32, 7).toString("base64"),
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("la versión del firmador registrada coincide con las dependencias exactas", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      dependencies: Record<string, string>;
    };
    expect(XML_SIGNER_VERSION).toBe(
      `facturacion-electronica-ec@${pkg.dependencies["facturacion-electronica-ec"]} (ec-sri-invoice-signer@${pkg.dependencies["ec-sri-invoice-signer"]})`,
    );
  });
});

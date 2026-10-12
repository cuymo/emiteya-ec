// Seguridad de la custodia (add-signing-certificate, design D7, D13 y D16): un fallo al auditar
// revierte el reemplazo; ni respuestas, ni errores, ni logs, ni auditoría, ni tablas contienen la
// contraseña ni el P12 en claro; métricas sin secretos; firmas que la clave no abre.
import { Registry } from "@prometheus-io/client";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CertificateCustodyConfig } from "../../src/config/env.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import type { SigningUnitOfWork } from "../../src/modules/signing/application/ports.ts";
import { createSigningCertificates } from "../../src/modules/signing/application/signing-certificate.ts";
import { createCertificateInspector } from "../../src/modules/signing/infrastructure/certificate-inspector.ts";
import { createCompanyRucReader } from "../../src/modules/signing/infrastructure/company-ruc.ts";
import { createCertificateVault } from "../../src/modules/signing/infrastructure/custody/certificate-vault.ts";
import {
  certificateTasksEntry,
  signingModule,
} from "../../src/modules/signing/infrastructure/index.ts";
import { createCertificateRepository } from "../../src/modules/signing/infrastructure/prisma-certificates.ts";
import { createSigningUnitOfWork } from "../../src/modules/signing/infrastructure/unit-of-work.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import {
  FIXTURE_NONASCII_PASSWORD,
  FIXTURE_PASSWORD,
  readFixture,
} from "../support/p12-fixtures.ts";
import { createMember } from "./auth-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertCompany } from "./fixtures.ts";
import { buildTaxpayerApp, sessionCookie } from "./taxpayer-harness.ts";

const dir = inject("p12FixturesDir");
const KEY = Buffer.alloc(32, 7);
const custody: CertificateCustodyConfig = { enabled: true, keyVersion: "1", key: KEY };
const keyring = { activeVersion: "1", keys: new Map([["1", KEY]]) };

describe("seguridad de la custodia de la firma", () => {
  let db: MigratedSchema;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });
  let api: ReturnType<typeof buildTaxpayerApp>;
  let companyId: string;
  let adminId: string;
  let cookie: string;

  beforeAll(async () => {
    db = await createMigratedSchema("signing_safety");
    api = buildTaxpayerApp(db, { signing: { pool, custody } });
    companyId = await insertCompany(db.database.prisma, "Empresa A");
    adminId = await createMember(api.uow, companyId, {
      name: "Admin",
      email: "admin@a.ec",
      role: "ADMIN",
    });
    cookie = await sessionCookie(api.app, "admin@a.ec");
  });

  afterAll(async () => {
    await pool.close();
    await db.drop();
  });

  const upload = (name: string, password: string, expectedCurrentId: string | null) =>
    request(api.app)
      .put("/api/v1/signing-certificate")
      .set("Cookie", cookie)
      .send({ file: readFixture(dir, name).toString("base64"), password, expectedCurrentId });

  it("ningún secreto aparece en respuestas, errores, logs, auditoría ni tablas", async () => {
    const responses: unknown[] = [];
    const first = await upload("sd-utf8.modern.p12", FIXTURE_PASSWORD, null);
    responses.push(first.body);
    const currentId = (first.body as { data: { certificate: { id: string } } }).data.certificate.id;
    responses.push(
      (await upload("sd-utf8.legacy.p12", "contraseña-equivocada-secreta", currentId)).body,
    );
    responses.push(
      (await upload("sd-utf8.modern.nonascii.p12", FIXTURE_NONASCII_PASSWORD, currentId)).body,
    );
    responses.push((await upload("noruc.modern.p12", FIXTURE_PASSWORD, currentId)).body);
    responses.push(
      (await upload("sd-profile.p12", "contraseña-equivocada-secreta", currentId)).body,
    );
    responses.push(
      (await request(api.app).get("/api/v1/signing-certificate").set("Cookie", cookie)).body,
    );

    const tables = await db.database.prisma.$queryRawUnsafe<{ row: string }[]>(
      [
        "signing_certificate",
        "signing_certificate_secret",
        "signing_certificate_settings",
        "audit_event",
      ]
        .map((table) => `SELECT row_to_json(t)::text AS row FROM "${db.name}"."${table}" t`)
        .join(" UNION ALL "),
    );
    const outputs = {
      responses: JSON.stringify(responses),
      logs: api.logs(),
      tables: tables.map((t) => t.row).join("\n"),
    };
    const p12 = readFixture(dir, "sd-utf8.modern.p12");
    const secrets = [
      FIXTURE_PASSWORD,
      FIXTURE_NONASCII_PASSWORD,
      "contraseña-equivocada-secreta",
      p12.toString("base64").slice(100, 160),
      p12.subarray(200, 232).toString("hex"),
      "PRIVATE KEY",
      "BEGIN ",
    ];
    for (const [where, text] of Object.entries(outputs)) {
      for (const secret of secrets)
        expect(text.includes(secret), `${where} contiene ${secret.slice(0, 12)}`).toBe(false);
    }
    // El secreto guardado existe, pero solo cifrado.
    expect(await db.database.prisma.signingCertificateSecret.count()).toBe(1);
  });

  it("si la auditoría falla, el reemplazo se revierte y la firma anterior conserva su secreto", async () => {
    const certificates = createCertificateRepository(db.database.prisma);
    const before = await certificates.findActive(companyId);
    const base = createSigningUnitOfWork(db.database.prisma);
    const failingAudit: SigningUnitOfWork = {
      run: (work) =>
        base.run((scope) =>
          work({
            ...scope,
            audit: {
              append: () => Promise.reject(new Error("auditoría caída")),
            },
          }),
        ),
    };
    const service = createSigningCertificates({
      uow: failingAudit,
      certificates,
      companyRuc: createCompanyRucReader(db.database.prisma),
      inspector: createCertificateInspector(pool),
      vault: createCertificateVault(keyring),
      authorizer: createAuthorizer({
        memberships: createMembershipReader(db.database.prisma),
        securityEvents: { emit: () => undefined },
      }),
      maxBytes: 64 * 1024,
    });
    await expect(
      service.upload(
        { userId: adminId, companyId, role: "ADMIN", requestId: "req-audit" },
        {
          file: readFixture(dir, "other-ruc.modern.p12").toString("base64"),
          password: FIXTURE_PASSWORD,
          expectedCurrentId: before!.id,
        },
      ),
    ).rejects.toThrow("auditoría caída");
    const after = await certificates.findActive(companyId);
    expect(after?.id).toBe(before!.id);
    expect(after?.secret).not.toBeNull();
    expect(await db.database.prisma.signingCertificate.count({ where: { companyId } })).toBe(1);
  });

  it("las métricas publican días y utilizable por empresa, sin secretos", async () => {
    const registry = new Registry();
    signingModule({
      prisma: db.database.prisma,
      authorizer: {} as never,
      custody,
      maxBytes: 65536,
      pool,
      metrics: registry,
    });
    const text = await registry.metrics();
    expect(text).toMatch(new RegExp(`signing_certificate_usable\\{company_id="${companyId}"\\} 1`));
    expect(text).toMatch(
      new RegExp(`signing_certificate_days_to_expiry\\{company_id="${companyId}"\\} \\d+`),
    );
    expect(text).not.toContain(FIXTURE_PASSWORD);
  });

  it("detecta al arrancar las firmas que la clave configurada no abre", async () => {
    const same = signingModule({
      prisma: db.database.prisma,
      authorizer: {} as never,
      custody,
      maxBytes: 65536,
      pool,
    });
    expect(await same.service.unopenable()).toEqual([]);
    const other = signingModule({
      prisma: db.database.prisma,
      authorizer: {} as never,
      custody: { enabled: true, keyVersion: "1", key: Buffer.alloc(32, 9) },
      maxBytes: 65536,
      pool,
    });
    expect((await other.service.unopenable()).map((c) => c.companyId)).toEqual([companyId]);
  });

  it("la firma con el perfil de Security Data se carga; una apertura que excede el plazo es 503 y no cambia nada", async () => {
    // support-security-data-pkcs12-iteration-profile: MAC 102 400 y contenidos cifrados 51 200.
    const before = await createCertificateRepository(db.database.prisma).findActive(companyId);
    const loaded = await upload("sd-profile.p12", FIXTURE_PASSWORD, before!.id);
    expect(loaded.status).toBe(200);
    const loadedId = (loaded.body as { data: { certificate: { id: string } } }).data.certificate.id;
    expect(loadedId).not.toBe(before!.id);

    // Contadores dentro del techo y contenidos repetidos: solo el timeout del pool lo corta.
    const slowPool = createCryptoWorkerPool({
      entry: certificateTasksEntry(),
      size: 1,
      timeoutMs: 300,
    });
    try {
      const slow = buildTaxpayerApp(db, { signing: { pool: slowPool, custody } });
      const slowCookie = await sessionCookie(slow.app, "admin@a.ec");
      const timedOut = await request(slow.app)
        .put("/api/v1/signing-certificate")
        .set("Cookie", slowCookie)
        .send({
          file: readFixture(dir, "many-containers.p12").toString("base64"),
          password: FIXTURE_PASSWORD,
          expectedCurrentId: loadedId,
        });
      expect(timedOut.status).toBe(503);
      expect((timedOut.body as { error: { code: string } }).error.code).toBe("CRYPTO_TIMEOUT");
      expect(JSON.stringify(timedOut.body) + slow.logs()).not.toContain(FIXTURE_PASSWORD);
    } finally {
      await slowPool.close();
    }
    const after = await request(api.app).get("/api/v1/signing-certificate").set("Cookie", cookie);
    expect(after.status).toBe(200);
    expect((after.body as { data: { certificate: { id: string } } }).data.certificate.id).toBe(
      loadedId,
    );
  });
});

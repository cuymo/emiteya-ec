// La comprobación final de la sesión de certificación contra PostgreSQL, sin red
// (docs/quality/sri-test-environment-checklist.md, sección G). Una instalación sintética en Pruebas,
// sin firma ni contrapartes: el CLI lee la base en solo lectura e informa qué falta, sin imprimir el
// RUC ni las identificaciones.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKEND_DIR, createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany } from "./fiscal-harness.ts";

const RUC = "1790012345001";

describe("sri:test-session-readiness sobre una instalación de Pruebas", () => {
  let db: MigratedSchema;
  const dir = mkdtempSync(join(tmpdir(), "sri-session-readiness-"));

  beforeAll(async () => {
    db = await createMigratedSchema("session_readiness");
    const prisma = db.database.prisma;
    const company = await insertFiscalCompany(prisma, "Certificación", 1);
    const version = await prisma.companyConfigVersion.create({
      data: {
        companyId: company.companyId,
        version: 1,
        ruc: RUC,
        legalName: "EMPRESA DE PRUEBA",
        headOfficeAddress: "Dirección de PRUEBA",
        accountingRequired: false,
        largeTaxpayer: false,
        environment: "TEST",
        createdById: company.adminId,
      },
    });
    await prisma.companyConfig.create({
      data: {
        companyId: company.companyId,
        currentVersionId: version.id,
        currentVersion: 1,
        updatedAt: new Date(),
      },
    });
    const closed = "https://127.0.0.1:9/cerrado";
    writeFileSync(
      join(dir, "cert.env"),
      [
        `DATABASE_URL=${db.url}`,
        "SRI_TRANSMISSION_ENABLED=0",
        `SRI_ENDPOINT_PRODUCTION_RECEPTION=${closed}`,
        `SRI_ENDPOINT_PRODUCTION_AUTHORIZATION=${closed}`,
        `SRI_ENDPOINT_PRODUCTION_VALIDITY=${closed}`,
      ].join("\n"),
      { mode: 0o600 },
    );
    writeFileSync(
      join(dir, "confirmations.json"),
      JSON.stringify({
        rucEnabledForElectronicInvoicing: true,
        testEnvironmentEnabled: true,
        taxDataMatchesSri: true,
        establishmentCode: "001",
        emissionPointCode: "001",
        documentTypesEnabled: ["01", "03", "04", "05", "06", "07"],
        counterparties: {
          TEST_IDENTIFIED_BUYER: {
            consent: "OWNER_CONTROLLED",
            identificationType: "05",
            identification: "ID-NO-REGISTRADA",
          },
        },
      }),
      { mode: 0o600 },
    );
    writeFileSync(
      join(dir, "egress.json"),
      JSON.stringify({ verify: "PASS", at: new Date().toISOString() }),
    );
  });

  afterAll(async () => {
    await db.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  it("informa lo que falta sin red y sin exponer el RUC ni las identificaciones", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--conditions=development",
        "scripts/sri-test-session-readiness.ts",
        "--backend-env-file",
        join(dir, "cert.env"),
        "--confirmations",
        join(dir, "confirmations.json"),
        "--egress-verify",
        join(dir, "egress.json"),
      ],
      { cwd: BACKEND_DIR, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as {
      readiness: string;
      network: string;
      checks: { name: string; ok: boolean }[];
    };
    expect(report).toMatchObject({ readiness: "FAIL", network: "NONE" });
    const status = Object.fromEntries(report.checks.map((check) => [check.name, check.ok]));
    expect(status).toMatchObject({
      "single-company-installation": true,
      "company-environment-test": true,
      "documents-environment-test": true,
      "establishment-confirmed": true,
      "emission-point-confirmed": true,
      "test-sequences-ready": true,
      "size-policy-active": true,
      "transmission-disabled-during-preparation": true,
      "test-endpoint-configured": true,
      "production-endpoint-inaccessible": true,
      "egress-allowlist-ready": true,
      // Sin firma vigente ni contrapartes registradas: no está lista.
      "p12-certification-ready": false,
      "certificate-not-expired": false,
      "ruc-matches-company": false,
      "test-counterparties-resolved": false,
    });
    expect(result.stdout).not.toContain(RUC);
    expect(result.stdout).not.toContain("ID-NO-REGISTRADA");
  });
});

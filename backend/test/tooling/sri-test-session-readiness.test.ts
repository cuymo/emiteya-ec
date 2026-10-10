// Comprobación final de la sesión de certificación en Pruebas, sin red
// (docs/quality/sri-test-environment-checklist.md, sección G). Datos sintéticos.
import { describe, expect, it } from "vitest";
import {
  evaluateSessionReadiness,
  type Confirmations,
  type Installation,
} from "../../scripts/support/sri-test-session-readiness.ts";

const NOW = new Date("2026-10-10T12:00:00Z");
const RUC = "1790012345001";
const CLOSED = "https://127.0.0.1:9/cerrado";
const env = {
  DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/x",
  SRI_TRANSMISSION_ENABLED: "0",
  SRI_ENDPOINT_PRODUCTION_RECEPTION: CLOSED,
  SRI_ENDPOINT_PRODUCTION_AUTHORIZATION: CLOSED,
  SRI_ENDPOINT_PRODUCTION_VALIDITY: CLOSED,
};
const confirmations: Confirmations = {
  rucEnabledForElectronicInvoicing: true,
  testEnvironmentEnabled: true,
  taxDataMatchesSri: true,
  establishmentCode: "001",
  emissionPointCode: "901",
  documentTypesEnabled: ["01", "03", "04", "05", "06", "07"],
  counterparties: {
    TEST_IDENTIFIED_BUYER: {
      consent: "OWNER_CONTROLLED",
      identificationType: "04",
      identification: "ID-COMPRADOR",
    },
    TEST_WITHHOLDING_SUBJECT: {
      consent: "WRITTEN_CONSENT",
      identificationType: "05",
      identification: "ID-RETENIDO",
    },
    TEST_PURCHASE_SETTLEMENT_SUPPLIER: {
      consent: "WRITTEN_CONSENT",
      identificationType: "05",
      identification: "ID-PROVEEDOR",
    },
  },
};
const installation: Installation = {
  companies: 1,
  environment: "TEST",
  companyRuc: RUC,
  documentsOutsideTest: 0,
  establishmentActive: true,
  emissionPointActive: true,
  productionSequencesOnPoint: 0,
  testNextNumbers: {},
  certificate: {
    present: true,
    secretPresent: true,
    notAfter: new Date("2026-11-12T00:00:00Z"),
    detectedRuc: RUC,
  },
  counterpartiesInInstallation: {
    TEST_IDENTIFIED_BUYER: true,
    TEST_WITHHOLDING_SUBJECT: true,
    TEST_PURCHASE_SETTLEMENT_SUPPLIER: true,
  },
};
const egress = { verify: "PASS", at: "2026-10-10T10:00:00Z" };
const run = (overrides: Partial<Parameters<typeof evaluateSessionReadiness>[0]> = {}) =>
  evaluateSessionReadiness({ confirmations, env, egress, installation, now: NOW, ...overrides });
const failed = (overrides: Partial<Parameters<typeof evaluateSessionReadiness>[0]> = {}) =>
  run(overrides)
    .filter((check) => !check.ok)
    .map((check) => check.name);

describe("comprobación final de la sesión de certificación (sin red)", () => {
  it("con todo confirmado, todas las comprobaciones pasan", () => {
    expect(failed()).toEqual([]);
    expect(run().find((c) => c.name === "certificate-not-expired")!.detail).toBe(
      "quedan 32 días (vence 2026-11-12)",
    );
  });

  it("exige la empresa y los comprobantes en Pruebas", () => {
    expect(failed({ installation: { ...installation, environment: "PRODUCTION" } })).toEqual([
      "company-environment-test",
    ]);
    expect(failed({ installation: { ...installation, documentsOutsideTest: 1 } })).toEqual([
      "documents-environment-test",
    ]);
  });

  it("exige la firma vigente, con secreto, el RUC de la empresa y margen de vencimiento", () => {
    expect(
      failed({
        installation: {
          ...installation,
          certificate: { ...installation.certificate, detectedRuc: "1790012345002" },
        },
      }),
    ).toEqual(["ruc-matches-company"]);
    const close = run({ now: new Date("2026-11-07T00:00:00Z") });
    const expiry = close.find((c) => c.name === "certificate-not-expired")!;
    expect(expiry.ok).toBe(false);
    expect(expiry.detail).toContain("CERTIFICATE_EXPIRY_TOO_CLOSE");
    expect(
      failed({
        installation: {
          ...installation,
          certificate: { ...installation.certificate, secretPresent: false },
        },
      }),
    ).toEqual(["p12-certification-ready"]);
  });

  it("la transmisión sigue apagada durante la preparación", () => {
    expect(failed({ env: { ...env, SRI_TRANSMISSION_ENABLED: "1" } })).toEqual([
      "transmission-disabled-during-preparation",
    ]);
  });

  it("Producción debe quedar inaccesible: sin sobrescribir, sería cel.sri.gob.ec", () => {
    const { SRI_ENDPOINT_PRODUCTION_RECEPTION: _omitted, ...rest } = env;
    const result = run({ env: rest });
    const production = result.find((c) => c.name === "production-endpoint-inaccessible")!;
    expect(production.ok).toBe(false);
    expect(production.detail).toContain("PRODUCTION_ACCESS_BLOCKED");
    expect(
      failed({ env: { ...env, SRI_ENDPOINT_TEST_RECEPTION: "https://otro.example/x" } }),
    ).toEqual(["test-endpoint-configured"]);
  });

  it("exige un verify reciente de la lista de permitidos", () => {
    expect(failed({ egress: null })).toEqual(["egress-allowlist-ready"]);
    expect(failed({ egress: { verify: "FAIL", at: egress.at } })).toEqual([
      "egress-allowlist-ready",
    ]);
    expect(failed({ egress: { verify: "PASS", at: "2026-10-08T00:00:00Z" } })).toEqual([
      "egress-allowlist-ready",
    ]);
  });

  it("exige el establecimiento, el punto dedicado, los seis tipos y los secuenciales de Pruebas", () => {
    expect(failed({ installation: { ...installation, emissionPointActive: null } })).toEqual([
      "emission-point-confirmed",
    ]);
    expect(
      failed({ confirmations: { ...confirmations, documentTypesEnabled: ["01", "04"] } }),
    ).toEqual(["six-document-types-confirmed"]);
    expect(failed({ installation: { ...installation, productionSequencesOnPoint: 1 } })).toEqual([
      "test-sequences-ready",
    ]);
    expect(
      failed({
        confirmations: { ...confirmations, lastUsedTestSequential: { "01": 7 } },
        installation: { ...installation, testNextNumbers: { "01": 5 } },
      }),
    ).toEqual(["test-sequences-ready"]);
  });

  it("exige las tres contrapartes con consentimiento; el proveedor de la liquidación sin RUC", () => {
    const { TEST_WITHHOLDING_SUBJECT: _omitted, ...two } = confirmations.counterparties;
    expect(failed({ confirmations: { ...confirmations, counterparties: two } })).toEqual([
      "test-counterparties-resolved",
    ]);
    expect(
      failed({
        confirmations: {
          ...confirmations,
          counterparties: {
            ...confirmations.counterparties,
            TEST_PURCHASE_SETTLEMENT_SUPPLIER: {
              consent: "WRITTEN_CONSENT",
              identificationType: "04",
              identification: "ID",
            },
          },
        },
      }),
    ).toEqual(["test-counterparties-resolved"]);
    expect(failed({ installation: { ...installation, counterpartiesInInstallation: {} } })).toEqual(
      ["test-counterparties-resolved"],
    );
  });

  it("no expone el RUC ni las identificaciones en el resultado", () => {
    const text = JSON.stringify(run());
    expect(text).not.toContain(RUC);
    expect(text).not.toMatch(/ID-COMPRADOR|ID-RETENIDO|ID-PROVEEDOR/);
  });
});

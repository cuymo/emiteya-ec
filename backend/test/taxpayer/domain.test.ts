import { describe, expect, it } from "vitest";
import { isEmissionPointAvailable } from "../../src/modules/taxpayer/domain/emission-structure.ts";
import { evaluateReadiness } from "../../src/modules/taxpayer/domain/readiness.ts";
import {
  logoChanges,
  profileChanges,
  sameConfig,
  type TaxpayerConfig,
  type TaxpayerProfile,
} from "../../src/modules/taxpayer/domain/taxpayer-config.ts";

const profile: TaxpayerProfile = {
  ruc: "1790012345001",
  legalName: "Comercial Andina S.A.",
  tradeName: null,
  headOfficeAddress: "Av. Amazonas N24-03, Quito",
  phone: null,
  email: null,
  accountingRequired: true,
  specialTaxpayerNumber: null,
  withholdingAgentResolution: null,
  largeTaxpayer: false,
  rimpeCategory: null,
  providerRuc: null,
};
const logo = { assetId: "a1", mimeType: "image/png", sizeBytes: 120, sha256: "f".repeat(64) };
const config: TaxpayerConfig = { profile, environment: "TEST", logo: null };

describe("comparación de la configuración (design D2)", () => {
  it("un guardado con los mismos valores no es un cambio", () => {
    expect(sameConfig(config, { ...config, profile: { ...profile } })).toBe(true);
  });

  it("cualquier dato, el ambiente o el logo distinto es un cambio", () => {
    expect(sameConfig(config, { ...config, profile: { ...profile, phone: "022551234" } })).toBe(
      false,
    );
    expect(sameConfig(config, { ...config, environment: "PRODUCTION" })).toBe(false);
    expect(sameConfig(config, { ...config, logo })).toBe(false);
  });

  it("el mismo contenido de logo con otro asset no es un cambio", () => {
    expect(sameConfig({ ...config, logo }, { ...config, logo: { ...logo, assetId: "a2" } })).toBe(
      true,
    );
  });
});

describe("diferencia para la auditoría (design D11)", () => {
  it("incluye solo los campos cambiados con su valor anterior y nuevo", () => {
    const after = {
      ...profile,
      legalName: "Andina Cía. Ltda.",
      headOfficeAddress: "Calle 2, Quito",
    };
    expect(profileChanges(profile, after)).toEqual({
      "legalName.from": "Comercial Andina S.A.",
      "legalName.to": "Andina Cía. Ltda.",
      "headOfficeAddress.from": "Av. Amazonas N24-03, Quito",
      "headOfficeAddress.to": "Calle 2, Quito",
    });
  });

  it("en el primer registro solo tiene valores nuevos, de los campos con valor", () => {
    const changes = profileChanges(null, profile);
    expect(Object.keys(changes).every((key) => key.endsWith(".to"))).toBe(true);
    expect(changes).toMatchObject({ "ruc.to": profile.ruc, "accountingRequired.to": true });
    expect(changes).not.toHaveProperty("tradeName.to");
  });

  it("registra el logo por sus metadatos y su ausencia como null", () => {
    expect(logoChanges(null, logo)).toEqual({
      "logoSha256.from": null,
      "logoSha256.to": logo.sha256,
      "logoMimeType.from": null,
      "logoMimeType.to": "image/png",
      "logoSizeBytes.from": null,
      "logoSizeBytes.to": 120,
    });
    expect(logoChanges(logo, null)["logoSha256.to"]).toBeNull();
  });
});

describe("disponibilidad de un punto de emisión (design D7)", () => {
  it("requiere que el punto y su establecimiento estén activos", () => {
    expect(isEmissionPointAvailable({ status: "ACTIVE" }, { status: "ACTIVE" })).toBe(true);
    expect(isEmissionPointAvailable({ status: "ACTIVE" }, { status: "INACTIVE" })).toBe(false);
    expect(isEmissionPointAvailable({ status: "INACTIVE" }, { status: "ACTIVE" })).toBe(false);
  });
});

describe("preparación para emitir (design D9)", () => {
  it("está preparada solo con los tres requisitos cumplidos", () => {
    const all = { TAXPAYER_DATA: true, EMISSION_POINT: true, SIGNING_CERTIFICATE: true };
    expect(evaluateReadiness(all).ready).toBe(true);
    for (const key of Object.keys(all) as (keyof typeof all)[]) {
      expect(evaluateReadiness({ ...all, [key]: false }).ready, key).toBe(false);
    }
  });

  it("lista los requisitos en orden con su estado", () => {
    expect(
      evaluateReadiness({ TAXPAYER_DATA: true, EMISSION_POINT: true, SIGNING_CERTIFICATE: false }),
    ).toEqual({
      ready: false,
      checks: [
        { key: "TAXPAYER_DATA", status: "MET" },
        { key: "EMISSION_POINT", status: "MET" },
        { key: "SIGNING_CERTIFICATE", status: "PENDING" },
      ],
    });
  });
});

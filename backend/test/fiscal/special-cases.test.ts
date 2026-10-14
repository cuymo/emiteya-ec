// Regla compartida de casos especiales del emisor (block-unsupported-special-cases-before-emission,
// design D1 y D5): qué anexos activa la configuración, a qué tipos alcanzan y cuáles se bloquean.
import { DOCUMENT_TYPES, type DocumentType } from "@facturador/contracts";
import { describe, expect, it } from "vitest";
import {
  SUPPORTED_SPECIAL_CASES,
  issuerSpecialCases,
  specialCaseApplies,
  unsupportedSpecialCase,
  type IssuerSpecialCaseProfile,
} from "../../src/modules/fiscal/domain/special-cases.ts";

const RUC = "1790012345001";
const profile = (overrides: Partial<IssuerSpecialCaseProfile> = {}): IssuerSpecialCaseProfile => ({
  ruc: RUC,
  withholdingAgentResolution: null,
  rimpeCategory: null,
  largeTaxpayer: false,
  providerRuc: null,
  ...overrides,
});
const blocked = (overrides: Partial<IssuerSpecialCaseProfile>) =>
  Object.fromEntries(
    DOCUMENT_TYPES.map((type) => [
      type,
      unsupportedSpecialCase(profile(overrides), type)?.annex ?? null,
    ]),
  ) as Record<DocumentType, number | null>;

describe("casos especiales del emisor", () => {
  it("el motor soporta solo el 21 y el 22", () => {
    expect([...SUPPORTED_SPECIAL_CASES].sort()).toEqual([21, 22]);
  });

  it("la configuración activa cada anexo, sin inferirlo", () => {
    expect(issuerSpecialCases(profile()).filter((rule) => rule.active)).toEqual([]);
    expect(
      issuerSpecialCases(
        profile({
          withholdingAgentResolution: "1",
          rimpeCategory: "EMPRENDEDOR",
          largeTaxpayer: true,
          providerRuc: "0992877878001",
        }),
      ).map((rule) => [rule.annex, rule.active]),
    ).toEqual([
      [21, true],
      [22, true],
      [24, true],
      [26, true],
    ]);
  });

  it("sin declaraciones no bloquea ningún tipo", () => {
    expect(Object.values(blocked({}))).toEqual([null, null, null, null, null, null]);
  });

  it("gran contribuyente bloquea la factura, la liquidación y las notas, no la guía ni la retención", () => {
    expect(blocked({ largeTaxpayer: true })).toEqual({
      "01": 24,
      "03": 24,
      "04": 24,
      "05": 24,
      "06": null,
      "07": null,
    });
  });

  it("un RUC proveedor de un tercero bloquea los seis tipos; el propio no", () => {
    expect(blocked({ providerRuc: "0992877878001" })).toEqual({
      "01": 26,
      "03": 26,
      "04": 26,
      "05": 26,
      "06": 26,
      "07": 26,
    });
    expect(Object.values(blocked({ providerRuc: RUC }))).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("el agente de retención y el RIMPE nunca bloquean", () => {
    expect(
      Object.values(
        blocked({ withholdingAgentResolution: "123", rimpeCategory: "NEGOCIO_POPULAR" }),
      ),
    ).toEqual([null, null, null, null, null, null]);
  });

  it("el mensaje identifica el anexo y no repite datos de la empresa", () => {
    const largeTaxpayer = unsupportedSpecialCase(profile({ largeTaxpayer: true }), "04")!;
    expect(largeTaxpayer.message).toContain("anexo 24");
    expect(largeTaxpayer.message).toContain("gran contribuyente");
    const provider = unsupportedSpecialCase(profile({ providerRuc: "0992877878001" }), "07")!;
    expect(provider.message).toContain("anexo 26");
    expect(provider.message).not.toContain("0992877878001");
    expect(provider.message).not.toContain(RUC);
  });

  it("la aplicabilidad cubre solo los anexos conocidos", () => {
    expect(specialCaseApplies(24, "06")).toBe(false);
    expect(specialCaseApplies(26, "06")).toBe(true);
    expect(specialCaseApplies(12, "01")).toBe(false);
  });
});

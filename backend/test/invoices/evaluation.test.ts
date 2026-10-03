// Evaluación de la factura antes de reservar (add-invoice-emission, tarea 8.2, design D6): una
// función pura que devuelve todos los problemas en el orden de los diez grupos. Aquí, los códigos
// que la base de datos hace difíciles de provocar y las reglas del anexo 26.
import { describe, expect, it } from "vitest";
import {
  evaluateInvoice,
  type AvailabilityLike,
  type EvaluationInput,
  type IssuerProfile,
} from "../../src/modules/invoices/domain/evaluation.ts";

const version = (code: string, extra: Partial<AvailabilityLike["applicable"] & object> = {}) => ({
  id: `${code}@1`,
  code,
  officialLabel: `Entrada ${code}`,
  sriTaxCode: null,
  rateKind: null,
  percentage: null,
  datasetVersion: 1,
  ...extra,
});
const usable = (code: string, extra = {}): AvailabilityLike => ({
  code,
  usable: true,
  calculationData: "COMPLETE",
  applicable: version(code, extra),
  latest: { officialLabel: `Entrada ${code}` },
});
const PROFILE: IssuerProfile = {
  ruc: "1790012345001",
  legalName: "COMERCIAL ANDINA S.A.",
  tradeName: null,
  headOfficeAddress: "Quito",
  accountingRequired: true,
  specialTaxpayerNumber: null,
  withholdingAgentResolution: null,
  largeTaxpayer: false,
  rimpeCategory: null,
  providerRuc: null,
};
const SPECIAL_CASES = [
  { annex: 21, topic: "Agente de retención", category: "CONDITIONAL_ISSUER_RULE" },
  { annex: 22, topic: "RIMPE", category: "CONDITIONAL_ISSUER_RULE" },
  { annex: 24, topic: "Gran contribuyente", category: "CONDITIONAL_ISSUER_RULE" },
  { annex: 26, topic: "Sistema de un tercero", category: "CONDITIONAL_GO_LIVE" },
];

const input = (overrides: Partial<EvaluationInput> = {}): EvaluationInput => ({
  issueDate: "2026-10-03",
  maxLines: 100,
  draft: {
    emissionPointId: "ep",
    buyerPartyId: "buyer",
    lines: [{ productId: "p1", quantity: "3", discount: "1.25" }],
    payments: [{ paymentMethod: "01", amount: null }],
  },
  config: { versionId: "v1", version: 1, profile: PROFILE, environment: "TEST" },
  point: {
    point: { id: "ep", code: "001", status: "ACTIVE" },
    establishment: { id: "e", code: "001", address: "Quito", status: "ACTIVE" },
  },
  certificate: { usable: true },
  buyer: {
    id: "buyer",
    identificationType: "04",
    identification: "0992877878001",
    legalName: "EL PERNO",
    address: null,
    roles: ["CUSTOMER"],
    status: "ACTIVE",
    systemRecord: null,
  },
  buyerIdentificationTypeUsable: true,
  products: new Map([
    [
      "p1",
      {
        id: "p1",
        mainCode: "CEM",
        auxiliaryCode: null,
        name: "Cemento",
        unitPrice: "8.75",
        status: "ACTIVE",
        taxes: [{ catalogType: "iva-rate", entryKey: "4" }],
      },
    ],
  ]),
  taxes: new Map([
    [
      "iva-rate",
      new Map([
        ["4", usable("4", { sriTaxCode: "2", rateKind: "PERCENTAGE", percentage: "15" })],
        ["7", usable("7", { sriTaxCode: "2", rateKind: "EXEMPT" })],
      ]),
    ],
  ]),
  paymentMethods: new Map([["01", usable("01")]]),
  consumerFinalPolicy: { id: "policy@1", maxAmount: "50", datasetVersion: 1 },
  specialCases: SPECIAL_CASES,
  schemaAvailable: true,
  ...overrides,
});
const codes = (value: EvaluationInput) => evaluateInvoice(value).issues.map((i) => i.code);

describe("evaluación de la factura (design D6)", () => {
  it("una factura completa no tiene problemas y lleva sus importes", () => {
    const evaluation = evaluateInvoice(input());
    expect(evaluation.issues).toEqual([]);
    expect(evaluation.totals?.total).toBe("28.75");
    expect(evaluation.payments).toEqual([
      expect.objectContaining({ code: "01", amount: "28.75", versionId: "01@1" }),
    ]);
  });

  it("referencias que desaparecieron: punto, comprador y producto", () => {
    expect(codes(input({ point: null }))).toEqual(["EMISSION_POINT_NOT_FOUND"]);
    expect(codes(input({ buyer: null }))).toEqual(["BUYER_NOT_FOUND"]);
    expect(codes(input({ products: new Map([["p1", null]]) }))).toEqual(["PRODUCT_NOT_FOUND"]);
  });

  it("el tipo de identificación del comprador sin versión vigente", () => {
    expect(codes(input({ buyerIdentificationTypeUsable: false }))).toEqual([
      "BUYER_IDENTIFICATION_TYPE_NOT_USABLE",
    ]);
  });

  it("consumidor final sin política vigente", () => {
    const consumerFinal = {
      ...input().buyer!,
      identificationType: "07",
      identification: "9999999999999",
      systemRecord: "CONSUMER_FINAL",
    };
    expect(codes(input({ buyer: consumerFinal, consumerFinalPolicy: null }))).toEqual([
      "CONSUMER_FINAL_POLICY_MISSING",
    ]);
    expect(codes(input({ buyer: consumerFinal }))).toEqual([]);
  });

  it("IVA exento y no objeto calculan al 0 %", () => {
    const exempt = input({
      products: new Map([
        [
          "p1",
          { ...input().products.get("p1")!, taxes: [{ catalogType: "iva-rate", entryKey: "7" }] },
        ],
      ]),
    });
    const evaluation = evaluateInvoice(exempt);
    expect(evaluation.issues).toEqual([]);
    expect(evaluation.lines[0]?.taxes[0]).toMatchObject({
      rateCode: "7",
      percentage: "0",
      amount: "0.00",
    });
  });

  it("muestra todos los problemas en el orden de los diez grupos", () => {
    const all = input({
      config: null,
      certificate: null,
      buyer: { ...input().buyer!, roles: ["SUPPLIER"], status: "INACTIVE" },
      draft: { ...input().draft, payments: [{ paymentMethod: "99", amount: null }] },
      schemaAvailable: false,
    });
    expect(codes(all)).toEqual([
      "TAXPAYER_NOT_CONFIGURED",
      "SIGNING_CERTIFICATE_NOT_USABLE",
      "BUYER_INACTIVE",
      "BUYER_NOT_CUSTOMER",
      "PAYMENT_METHOD_NOT_USABLE",
      "SCHEMA_NOT_AVAILABLE",
    ]);
  });

  it("un límite de líneas reducido después de guardar se comprueba al emitir", () => {
    expect(codes(input({ maxLines: 0 }))).toEqual(["INVOICE_TOO_MANY_LINES"]);
  });

  describe("casos especiales del emisor (anexos 21, 22, 24 y 26)", () => {
    const withProfile = (profile: Partial<IssuerProfile>) =>
      input({
        config: {
          versionId: "v1",
          version: 1,
          profile: { ...PROFILE, ...profile },
          environment: "TEST",
        },
      });

    it("agente de retención, RIMPE y gran contribuyente están soportados", () => {
      const evaluation = evaluateInvoice(
        withProfile({
          withholdingAgentResolution: "1",
          rimpeCategory: "EMPRENDEDOR",
          largeTaxpayer: true,
        }),
      );
      expect(evaluation.issues).toEqual([]);
      expect(
        evaluation.specialCases.filter((rule) => rule.active).map((rule) => rule.annex),
      ).toEqual([21, 22, 24]);
    });

    it("el anexo 26 aplica con un RUC proveedor distinto del propio y no está soportado", () => {
      const evaluation = evaluateInvoice(withProfile({ providerRuc: "0992877878001" }));
      expect(evaluation.issues).toEqual([
        {
          code: "SPECIAL_CASE_UNSUPPORTED",
          message:
            "El anexo 26 (Sistema de un tercero) aplica a esta factura y su generación todavía no está soportada.",
          line: null,
          payment: null,
        },
      ]);
    });

    it("sin RUC proveedor, o con el propio, el anexo 26 no aplica", () => {
      expect(codes(withProfile({ providerRuc: null }))).toEqual([]);
      expect(codes(withProfile({ providerRuc: PROFILE.ruc }))).toEqual([]);
      expect(
        evaluateInvoice(withProfile({ providerRuc: PROFILE.ruc })).specialCases.find(
          (rule) => rule.annex === 26,
        ),
      ).toMatchObject({ active: false, supported: false });
    });

    it("un anexo activado que la matriz no clasifica como soportable se rechaza", () => {
      const matrix = SPECIAL_CASES.map((entry) =>
        entry.annex === 22 ? { ...entry, category: "OUT_OF_MVP" } : entry,
      );
      expect(
        codes({ ...withProfile({ rimpeCategory: "NEGOCIO_POPULAR" }), specialCases: matrix }),
      ).toEqual(["SPECIAL_CASE_UNSUPPORTED"]);
    });
  });

  it("la fuente no usa number ni la librería decimal directamente", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../src/modules/invoices/domain/evaluation.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\b(Number|parseFloat|parseInt)\(|toFixed|decimal\.js|new Decimal/);
  });
});

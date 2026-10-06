// Snapshot autosuficiente del comprobante de retención (add-withholding-receipts, tarea 4.3, design
// D4 y D14): el sujeto, la parte relacionada como declaración del usuario (nunca verificada), el
// período, cada documento con sus impuestos, pagos y retenciones anidadas con sus referencias de
// catálogo, la versión del cálculo y el total retenido.
import { describe, expect, it } from "vitest";
import { buildWithholdingSnapshot } from "../../src/modules/withholding-receipts/domain/build-snapshot.ts";
import { evaluateWithholdingReceipt } from "../../src/modules/withholding-receipts/domain/evaluation.ts";
import {
  WITHHOLDING_SNAPSHOT_VERSION,
  withWithholdingKey,
} from "../../src/modules/withholding-receipts/domain/snapshot.ts";
import { ISSUE_DATE, SUPPLIER, SUPPORT, evaluationInput } from "./fixtures.ts";

const SCHEMA = {
  documentType: "07" as const,
  version: "2.0.0",
  path: "sri-xsd/ComprobanteRetencion_V2.0.0.xsd",
  sha256: "1e006d6d16c791c8f5b23d1f3e006cd066ccba2bfb797a3cb9098bd09c793cb7",
  imports: [{ path: "w3c-xsd/xmldsig-core-schema.xsd", sha256: "b".repeat(64) }],
};
const CONFIG = {
  versionId: "config-1",
  version: 3,
  environment: "TEST" as const,
  profile: {
    ruc: "1790012345001",
    legalName: "EMPRESA AGENTE S.A.",
    tradeName: null,
    headOfficeAddress: "Av. Amazonas",
    accountingRequired: true,
    specialTaxpayerNumber: "12345",
    withholdingAgentResolution: "1",
    rimpeCategory: null,
  },
};
const POINT = {
  point: { id: "point-1", code: "002" },
  establishment: { id: "est-1", code: "001", address: "Calle 1" },
};
const SECOND = {
  ...SUPPORT,
  documentType: "03",
  supportCode: "02",
  number: "001002000000045",
  authorizationNumber: null,
  taxes: [
    { tax: "2", rateEntryKey: "4", rate: null, base: "100.00", amount: "15.00" },
    { tax: "3", rateEntryKey: "3011", rate: "150", base: "20.00", amount: "30.00" },
    { tax: "5", rateEntryKey: "5001", rate: "0.02", base: "10.00", amount: "0.20" },
  ],
  payments: [
    { paymentMethod: "01", total: "50.00" },
    { paymentMethod: "20", total: "95.20" },
  ],
  withholdings: [{ tax: "2", entryKey: "7", base: "15.00" }],
};

function build(supports = [SUPPORT, SECOND]) {
  const evaluation = evaluateWithholdingReceipt(evaluationInput({ draft: { supports } }));
  expect(evaluation.issues).toEqual([]);
  return buildWithholdingSnapshot({
    subject: SUPPLIER,
    relatedParty: "SI",
    fiscalPeriod: "09/2026",
    declared: { by: "user-1", byName: "Ana Operadora", at: new Date("2026-10-06T15:00:00Z") },
    supports: evaluation.supports,
    amounts: evaluation.amounts!,
    config: CONFIG,
    point: POINT,
    schema: SCHEMA,
    builderVersion: "1",
    datasetVersions: {
      "withholding-tax": 1,
      "withholding-income-concept": 1,
      "withholding-iva-code": 1,
      "support-document-type": 1,
      "support-code": 1,
      "payment-method": 1,
      "iva-rate": 1,
      "ice-rate": 1,
      "irbpnr-rate": 1,
      tax: 1,
      "schema-registry": 2,
      "identification-type": 1,
    },
    issueDate: ISSUE_DATE,
  });
}

describe("snapshot del comprobante de retención", () => {
  it("guarda el sujeto, la parte relacionada declarada por el usuario y el período elegido", () => {
    const snapshot = build();
    expect(snapshot.snapshotVersion).toBe(WITHHOLDING_SNAPSHOT_VERSION);
    expect(snapshot.subject).toEqual({
      partyId: "party-1",
      identificationType: "04",
      identification: "1791234567001",
      legalName: "PROVEEDORA DEL SUR S.A.",
    });
    expect(snapshot.relatedParty).toEqual({
      value: "SI",
      basis: "USER_DECLARED",
      declaredBy: "user-1",
      declaredByName: "Ana Operadora",
      declaredAt: "2026-10-06T15:00:00.000Z",
    });
    expect(JSON.stringify(snapshot)).not.toContain("SYSTEM_VERIFIED");
    expect(snapshot.fiscalPeriod).toBe("09/2026");
    expect(snapshot).toMatchObject({
      issueDate: ISSUE_DATE,
      environment: "TEST",
      environmentCode: "1",
      taxpayerConfig: { versionId: "config-1", version: 3 },
      issuer: {
        ruc: "1790012345001",
        specialTaxpayerNumber: "12345",
        emissionPoint: { code: "002" },
      },
      schema: SCHEMA,
    });
  });

  it("guarda cada documento con sus impuestos, pagos y retenciones anidadas y sus referencias", () => {
    const [first, second] = build().supports;
    expect(first).toMatchObject({
      position: 1,
      documentType: {
        code: "01",
        label: "Factura",
        ref: { catalogType: "support-document-type", entryKey: "01" },
      },
      supportCode: { code: "01", ref: { catalogType: "support-code", entryKey: "01" } },
      number: "001001000000123",
      issueDate: "2026-10-01",
      authorizationNumber: "1".repeat(49),
      totalWithoutTaxes: "100.29",
      importTotal: "115.33",
    });
    expect(first?.withholdings[0]).toMatchObject({
      position: 1,
      tax: "1",
      taxLabel: "RENTA",
      taxRef: { catalogType: "withholding-tax", entryKey: "1" },
      code: "312C",
      ref: { catalogType: "withholding-income-concept", entryKey: "312C" },
      base: "100.29",
      percentage: "1.75",
      amount: "1.76",
    });
    expect(first?.withholdings).toEqual([
      expect.objectContaining({ position: 1, code: "312C" }),
      expect.objectContaining({
        position: 2,
        tax: "2",
        code: "1",
        percentage: "30",
        amount: "4.51",
      }),
    ]);
    expect(second?.documentType.code).toBe("03");
    expect(second?.authorizationNumber).toBeNull();
    expect(
      second?.taxes.map((t) => [
        t.taxCode,
        t.taxLabel,
        t.rateCode,
        t.tariff,
        t.tariffBasis,
        t.base,
        t.amount,
      ]),
    ).toEqual([
      ["2", "IVA", "4", "15", "CATALOG", "100.00", "15.00"],
      ["3", "ICE", "3011", "150", "USER_DECLARED", "20.00", "30.00"],
      ["5", "IRBPNR", "5001", "0.02", "USER_DECLARED", "10.00", "0.20"],
    ]);
    expect(second?.taxes[1]?.rateRef).toMatchObject({ catalogType: "ice-rate", entryKey: "3011" });
    expect(second?.payments.map((p) => [p.position, p.code, p.total, p.ref.catalogType])).toEqual([
      [1, "01", "50.00", "payment-method"],
      [2, "20", "95.20", "payment-method"],
    ]);
    expect(second?.withholdings).toEqual([
      expect.objectContaining({
        tax: "2",
        code: "7",
        label: "Retención en cero 0.00%",
        percentage: "0",
        amount: "0.00",
      }),
    ]);
  });

  it("guarda la versión del cálculo, el total retenido y los catálogos usados", () => {
    const snapshot = build();
    expect(snapshot.calculationVersion).toBe(1);
    expect(snapshot.totals).toEqual({ withheld: "6.27" });
    expect(snapshot.catalogDatasets).toEqual({
      "ice-rate": 1,
      "irbpnr-rate": 1,
      "iva-rate": 1,
      "payment-method": 1,
      "schema-registry": 2,
      "support-code": 1,
      "support-document-type": 1,
      tax: 1,
      "withholding-income-concept": 1,
      "withholding-iva-code": 1,
      "withholding-tax": 1,
    });
  });

  it("agrega la clave de la reserva sin tocar lo demás", () => {
    const draft = build([SUPPORT]);
    const key = {
      documentNumber: "001-002-000000001",
      sequential: "000000001",
      numericCode: "12345678",
      emissionType: "1" as const,
      accessKey: "0".repeat(49),
    };
    expect(withWithholdingKey(draft, key)).toEqual({ ...draft, key });
  });

  it("no se construye si las retenciones no son las del cálculo", () => {
    const evaluation = evaluateWithholdingReceipt(evaluationInput());
    expect(() =>
      buildWithholdingSnapshot({
        subject: SUPPLIER,
        relatedParty: "NO",
        fiscalPeriod: "10/2026",
        declared: { by: "u", byName: null, at: new Date() },
        supports: evaluation.supports,
        amounts: { ...evaluation.amounts!, items: evaluation.amounts!.items.slice(0, 1) },
        config: CONFIG,
        point: POINT,
        schema: SCHEMA,
        builderVersion: "1",
        datasetVersions: {},
        issueDate: ISSUE_DATE,
      }),
    ).toThrow(/no son las del cálculo/);
  });
});

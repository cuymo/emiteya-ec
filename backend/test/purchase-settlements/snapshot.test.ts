// Snapshot autosuficiente de la liquidación de compra (add-purchase-settlements, tarea 4.3, design D3 y
// D11): congela el emisor, el proveedor con su dirección, la procedencia con las cuatro declaraciones
// del usuario, las líneas con su IVA y sus referencias de catálogo, el cálculo y su versión, los pagos
// con su plazo y su unidad de tiempo y la moneda. Es JSON puro: el XML y el RIDE salen de él sin leer
// el tercero, los productos, los catálogos ni la configuración vigentes.
import { describe, expect, it } from "vitest";
import { buildPurchaseSettlementSnapshot } from "../../src/modules/purchase-settlements/domain/build-snapshot.ts";
import { evaluatePurchaseSettlement } from "../../src/modules/purchase-settlements/domain/evaluation.ts";
import {
  PURCHASE_SETTLEMENT_SNAPSHOT_VERSION,
  withPurchaseSettlementKey,
} from "../../src/modules/purchase-settlements/domain/snapshot.ts";
import { ISSUE_DATE, PRODUCT, evaluationInput, line, SPEC_PAYMENTS } from "./fixtures.ts";

const CONFIG = {
  versionId: "cfg-1",
  version: 3,
  environment: "TEST" as const,
  profile: {
    ruc: "1790012345001",
    legalName: "DISTRIBUIDORA NACIONAL S.A.",
    tradeName: "DINASA",
    headOfficeAddress: "Av. Amazonas N24-03, Quito",
    accountingRequired: true,
    specialTaxpayerNumber: null,
    withholdingAgentResolution: "1",
    rimpeCategory: null,
  },
};
const POINT = {
  point: { id: "pt-1", code: "002" },
  establishment: { id: "es-1", code: "001", address: "Av. 6 de Diciembre N33-55, Quito" },
};
const SCHEMA = {
  documentType: "03" as const,
  version: "1.1.0",
  path: "sri-xsd/LiquidacionCompra_V1.1.0.xsd",
  sha256: "58c9cd96",
  imports: [],
};

function build(input = evaluationInput()) {
  const evaluation = evaluatePurchaseSettlement(input);
  expect(evaluation.issues).toEqual([]);
  return buildPurchaseSettlementSnapshot({
    supplier: evaluation.supplier!,
    address: evaluation.address!,
    lines: evaluation.lines,
    payments: evaluation.payments,
    amounts: evaluation.amounts!,
    declared: { by: "user-1", byName: "Ana Torres", at: new Date("2026-10-07T15:30:00Z") },
    config: CONFIG,
    point: POINT,
    schema: SCHEMA,
    builderVersion: "1",
    datasetVersions: { "iva-rate": 1, "payment-method": 2, "schema-registry": 2, tax: 1 },
    issueDate: ISSUE_DATE,
  });
}

describe("snapshot de la liquidación de compra (design D11)", () => {
  it("congela el emisor, el proveedor con su dirección y la procedencia con las cuatro declaraciones", () => {
    const snapshot = build();
    expect(snapshot).toMatchObject({
      snapshotVersion: PURCHASE_SETTLEMENT_SNAPSHOT_VERSION,
      schema: SCHEMA,
      builderVersion: "1",
      calculationVersion: "purchase-settlement-amounts-1",
      catalogDatasets: { "iva-rate": 1, "payment-method": 2, "schema-registry": 2 },
      taxpayerConfig: { versionId: "cfg-1", version: 3 },
      issueDate: ISSUE_DATE,
      environment: "TEST",
      environmentCode: "1",
      issuer: {
        ruc: "1790012345001",
        establishment: POINT.establishment,
        emissionPoint: POINT.point,
        withholdingAgentResolution: "1",
      },
      supplier: {
        partyId: "party-1",
        identificationType: "05",
        identification: "0102030405",
        legalName: "María Quishpe",
        address: "Comunidad San Pablo, Cayambe",
      },
      currency: "DOLAR",
      counts: { lines: 2, payments: 2 },
    });
    expect(snapshot.eligibility).toEqual({
      case: "ART_13_C",
      policy: "PURCHASE_SETTLEMENT_ELIGIBILITY_V1",
      rule: "ART_13_C_RUSTICITY_NO_ACTIVE_RUC",
      policyVersion: 1,
      declarations: [
        "NATURAL_PERSON_NOT_REQUIRED_TO_KEEP_ACCOUNTING",
        "NO_RUC_OR_SUSPENDED_RUC",
        "UNABLE_TO_ISSUE_DUE_TO_CULTURAL_LEVEL_OR_RUSTICITY",
        "MOVABLE_GOODS_OR_SERVICES_TRANSACTION",
      ].map((statementId) => ({
        statementId,
        policyVersion: 1,
        basis: "USER_DECLARED",
        declaredBy: "user-1",
        declaredByName: "Ana Torres",
        declaredAt: "2026-10-07T15:30:00.000Z",
      })),
    });
  });

  it("congela las líneas con su IVA y su referencia de catálogo, los totales y los pagos con plazo", () => {
    const snapshot = build(
      evaluationInput({
        draft: {
          lines: [
            line({
              productId: PRODUCT.id,
              mainCode: "CAC-01",
              quantity: "10.000",
              unitPrice: "4.50",
            }),
            line({
              description: "Jornal de cosecha",
              unit: null,
              quantity: "2",
              unitPrice: "30",
              discount: "0",
              ivaRate: "0",
            }),
          ],
          payments: SPEC_PAYMENTS,
        },
      }),
    );
    expect(snapshot.lines).toHaveLength(2);
    expect(snapshot.lines[0]).toEqual({
      position: 1,
      productId: PRODUCT.id,
      mainCode: "CAC-01",
      auxiliaryCode: null,
      description: "Saco de cacao en grano, 45 kg",
      unit: "saco",
      quantity: "10",
      unitPrice: "4.5",
      discount: "5.00",
      taxableBase: "40.00",
      tax: {
        taxCode: "2",
        rateCode: "4",
        rateKind: "PERCENTAGE",
        percentage: "15",
        label: "15%",
        ref: {
          catalogType: "iva-rate",
          entryKey: "4",
          versionId: "iva-rate:4:v1",
          datasetVersion: 1,
        },
        base: "40.00",
        amount: "6.00",
      },
    });
    expect(snapshot.lines[1]).toMatchObject({
      position: 2,
      productId: null,
      discount: "0.00",
      taxableBase: "60.00",
      tax: { rateCode: "0", percentage: "0", amount: "0.00" },
    });
    expect(snapshot.totals).toEqual({
      withoutTaxes: "100.00",
      discount: "5.00",
      taxes: [
        { taxCode: "2", rateCode: "0", percentage: "0", base: "60.00", amount: "0.00" },
        { taxCode: "2", rateCode: "4", percentage: "15", base: "40.00", amount: "6.00" },
      ],
      total: "106.00",
    });
    expect(
      snapshot.payments.map(({ code, total, term, timeUnit }) => ({ code, total, term, timeUnit })),
    ).toEqual([
      { code: "01", total: "50.00", term: "0", timeUnit: "días" },
      { code: "20", total: "56.00", term: "30", timeUnit: "días" },
    ]);
  });

  it("es JSON puro y autosuficiente, y la clave se añade al reservar", () => {
    const draft = build();
    const snapshot = withPurchaseSettlementKey(draft, {
      documentNumber: "001-002-000000001",
      sequential: "000000001",
      numericCode: "12345678",
      emissionType: "1",
      accessKey: "0".repeat(49),
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.key.documentNumber).toBe("001-002-000000001");
    // Lo que el XML y el RIDE necesitan está en el snapshot, sin identificadores que releer.
    for (const field of ["issuer", "supplier", "lines", "totals", "payments", "currency"]) {
      expect(snapshot).toHaveProperty(field);
    }
  });

  it("no se construye con líneas que no son las del cálculo", () => {
    const evaluation = evaluatePurchaseSettlement(evaluationInput());
    expect(() =>
      buildPurchaseSettlementSnapshot({
        supplier: evaluation.supplier!,
        address: evaluation.address!,
        lines: evaluation.lines.slice(0, 1),
        payments: evaluation.payments,
        amounts: evaluation.amounts!,
        declared: { by: "u", byName: null, at: new Date() },
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

// Snapshot autosuficiente de la nota de débito (add-debit-notes, tarea 3.3, design D8, D9 y D13):
// guarda la factura con su autorización y sus tratamientos con sus referencias fiscales, los
// conceptos, el resultado del cálculo con su versión, una sola forma de pago trazable por el valor
// total y la declaración del usuario, nunca verificada por el sistema.
import { describe, expect, it } from "vitest";
import { buildDebitNoteSnapshot } from "../../src/modules/debit-notes/domain/build-snapshot.ts";
import { evaluateDebitNote } from "../../src/modules/debit-notes/domain/evaluation.ts";
import { withDebitNoteKey } from "../../src/modules/debit-notes/domain/snapshot.ts";
import { IVA_0, IVA_15 } from "./fixtures.ts";

const TREATMENTS = [IVA_0, IVA_15];
const evaluation = evaluateDebitNote({
  invoice: {
    state: "AUTHORIZED",
    intact: true,
    consumerFinal: false,
    environment: "TEST",
    treatments: TREATMENTS,
  },
  companyEnvironment: "TEST",
  request: {
    concepts: [
      {
        cause: "LATE_PAYMENT_INTEREST",
        description: "Intereses por 30 días de mora",
        amount: "20",
        taxTreatment: "2:4",
      },
      {
        cause: "POST_INVOICE_COST_EXPENSE",
        description: "Flete posterior a la venta",
        amount: "5.50",
        taxTreatment: "2:0",
      },
    ],
    payment: {
      entryKey: "20",
      usable: true,
      version: {
        code: "20",
        versionId: "pm-20",
        datasetVersion: 3,
        officialLabel: "OTROS CON UTILIZACION DEL SISTEMA FINANCIERO",
      },
    },
  },
});

const build = (payment = evaluation.payment!) =>
  buildDebitNoteSnapshot({
    invoice: {
      id: "inv-1",
      documentNumber: "001-001-000000007",
      issueDate: "2026-09-01",
      accessKey: "0".repeat(49),
      environment: "TEST",
      authorization: { number: "1".repeat(49), date: new Date("2026-09-01T15:00:00Z") },
      snapshotVersion: 2,
      buyer: {
        identificationType: "04",
        identification: "1790012345001",
        legalName: "Comprador S.A.",
        address: "Quito",
      },
      treatments: TREATMENTS,
    },
    config: {
      versionId: "cfg-1",
      version: 4,
      environment: "TEST",
      profile: {
        ruc: "1790011122001",
        legalName: "Emisor S.A.",
        tradeName: null,
        headOfficeAddress: "Matriz",
        accountingRequired: true,
        specialTaxpayerNumber: null,
        withholdingAgentResolution: null,
        rimpeCategory: null,
      },
    },
    point: {
      point: { id: "pt-1", code: "001" },
      establishment: { id: "est-1", code: "001", address: "Sucursal" },
    },
    schema: {
      documentType: "05",
      version: "1.0.0",
      path: "sri-xsd/NotaDebito_V1.0.0.xsd",
      sha256: "f".repeat(64),
      imports: [],
    },
    builderVersion: "1",
    datasetVersions: { "iva-rate": 1, "payment-method": 3, "schema-registry": 2, tax: 1 },
    issueDate: "2026-10-09",
    concepts: evaluation.concepts,
    amounts: evaluation.amounts!,
    payment,
    declarations: {
      version: 1,
      statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"],
      declaredBy: "user-1",
      declaredAt: "2026-10-09T15:00:00.000Z",
      basis: "USER_DECLARED",
    },
  });

describe("snapshot de la nota de débito", () => {
  it("guarda la factura con su autorización y todos sus tratamientos con sus referencias", () => {
    const snapshot = build();
    expect(snapshot.invoice).toEqual({
      id: "inv-1",
      documentType: "01",
      documentNumber: "001-001-000000007",
      issueDate: "2026-09-01",
      accessKey: "0".repeat(49),
      authorizationNumber: "1".repeat(49),
      authorizationDate: "2026-09-01T15:00:00.000Z",
      environment: "TEST",
      snapshotVersion: 2,
      taxTreatments: TREATMENTS,
    });
    expect(snapshot.buyer.legalName).toBe("Comprador S.A.");
  });

  it("guarda los conceptos con su base de dos decimales y el resultado del cálculo con su versión", () => {
    const snapshot = build();
    expect(snapshot.calculationVersion).toBe(1);
    expect(snapshot.concepts).toEqual([
      {
        position: 1,
        cause: "LATE_PAYMENT_INTEREST",
        description: "Intereses por 30 días de mora",
        amount: "20.00",
        taxTreatment: "2:4",
      },
      {
        position: 2,
        cause: "POST_INVOICE_COST_EXPENSE",
        description: "Flete posterior a la venta",
        amount: "5.50",
        taxTreatment: "2:0",
      },
    ]);
    expect(snapshot.taxes).toEqual([
      { taxCode: "2", rateCode: "0", percentage: "0", base: "5.50", amount: "0.00" },
      { taxCode: "2", rateCode: "4", percentage: "15", base: "20.00", amount: "3.00" },
    ]);
    expect(snapshot.totals).toEqual({ withoutTaxes: "25.50", total: "28.50" });
  });

  it("guarda exactamente una forma de pago trazable por el valor total", () => {
    const snapshot = build();
    expect(snapshot.payments).toEqual([
      {
        position: 1,
        entryKey: "20",
        code: "20",
        catalogType: "payment-method",
        versionId: "pm-20",
        datasetVersion: 3,
        officialLabel: "OTROS CON UTILIZACION DEL SISTEMA FINANCIERO",
        amount: "28.50",
      },
    ]);
    expect(snapshot.payments[0].amount).toBe(snapshot.totals.total);
    expect(snapshot.catalogDatasets).toEqual({
      "iva-rate": 1,
      "payment-method": 3,
      "schema-registry": 2,
    });
  });

  it("guarda la declaración como declarada por el usuario y nunca como verificada", () => {
    const snapshot = withDebitNoteKey(build(), {
      documentNumber: "001-001-000000001",
      sequential: "000000001",
      numericCode: "12345678",
      emissionType: "1",
      accessKey: "5".repeat(49),
    });
    expect(snapshot.declarations).toEqual({
      version: 1,
      statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"],
      declaredBy: "user-1",
      declaredAt: "2026-10-09T15:00:00.000Z",
      basis: "USER_DECLARED",
    });
    expect(JSON.stringify(snapshot)).not.toContain("SYSTEM_VERIFIED");
    expect(snapshot.key.accessKey).toBe("5".repeat(49));
  });

  it("guarda el emisor vigente al reservar y el esquema de la nota de débito", () => {
    const snapshot = build();
    expect(snapshot.schema.documentType).toBe("05");
    expect(snapshot.environmentCode).toBe("1");
    expect(snapshot.issuer).toMatchObject({
      ruc: "1790011122001",
      establishment: { id: "est-1", code: "001", address: "Sucursal" },
      emissionPoint: { id: "pt-1", code: "001" },
    });
  });

  it("no construye un snapshot si la forma de pago no cubre el valor total", () => {
    expect(() => build({ ...evaluation.payment!, amount: "28.49" })).toThrow(
      "no cubre el valor total",
    );
  });
});

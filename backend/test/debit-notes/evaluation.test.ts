// Evaluación de la nota de débito antes de reservar (add-debit-notes, tarea 3.2, design D4 a D11):
// cada rechazo con su código y la posición del concepto, en el orden de D4; el consumidor final como
// política del proyecto; los tratamientos de la factura como únicas opciones; la forma de pago
// resuelta por el catálogo, con su total igual al valor total; y ningún plazo de emisión.
import { describe, expect, it } from "vitest";
import {
  evaluateDebitNote,
  paymentCoversTotal,
  type DebitInvoice,
  type DebitNoteEvaluationInput,
  type ResolvedPaymentMethod,
} from "../../src/modules/debit-notes/domain/evaluation.ts";
import type { DebitNoteDraftConcept } from "../../src/modules/debit-notes/domain/draft.ts";
import { debitNotePreview } from "../../src/modules/debit-notes/domain/preview.ts";
import { invoiceTaxTreatments } from "../../src/modules/debit-notes/domain/treatments.ts";
import { EXEMPT, IVA_0, IVA_15 } from "./fixtures.ts";

const INVOICE: DebitInvoice = {
  state: "AUTHORIZED",
  intact: true,
  consumerFinal: false,
  environment: "TEST",
  treatments: [IVA_0, IVA_15],
};
const CONCEPT: DebitNoteDraftConcept = {
  cause: "LATE_PAYMENT_INTEREST",
  description: "Intereses por 30 días de mora",
  amount: "20.00",
  taxTreatment: "2:4",
};
const CASH: ResolvedPaymentMethod = {
  entryKey: "01",
  usable: true,
  version: {
    code: "01",
    versionId: "pm-01",
    datasetVersion: 1,
    officialLabel: "SIN UTILIZACION DEL SISTEMA FINANCIERO",
  },
};
const DECLARATIONS = { version: 1, statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"] };

const evaluate = (overrides: Partial<DebitNoteEvaluationInput> = {}) =>
  evaluateDebitNote({
    invoice: INVOICE,
    companyEnvironment: "TEST",
    request: { concepts: [CONCEPT], payment: CASH, declarations: DECLARATIONS },
    ...overrides,
  });
const request = (changes: Partial<DebitNoteEvaluationInput["request"]>) => ({
  request: { concepts: [CONCEPT], payment: CASH, declarations: DECLARATIONS, ...changes },
});
const codes = (result: ReturnType<typeof evaluate>) =>
  result.issues.map((found) => [found.code, found.concept]);

describe("evaluación de la nota de débito", () => {
  it("una nota válida no tiene problemas, se calcula y lleva su forma de pago por el valor total", () => {
    const result = evaluate();
    expect(result.issues).toEqual([]);
    expect(result.concepts).toEqual([{ position: 1, ...CONCEPT }]);
    expect(result.amounts?.total).toBe("23.00");
    expect(result.payment).toEqual({
      entryKey: "01",
      code: "01",
      catalogType: "payment-method",
      versionId: "pm-01",
      datasetVersion: 1,
      officialLabel: "SIN UTILIZACION DEL SISTEMA FINANCIERO",
      amount: "23.00",
    });
  });

  it("solo una factura autorizada e íntegra admite nota de débito, y nada más se evalúa", () => {
    for (const state of [
      "RESERVED",
      "SIGNED",
      "RECEIVED",
      "SEND_UNKNOWN",
      "MANUAL_REVIEW",
      "RETURNED",
      "NOT_AUTHORIZED",
    ]) {
      expect(codes(evaluate({ invoice: { ...INVOICE, state } }))).toEqual([
        ["DEBIT_NOTE_INVOICE_NOT_ELIGIBLE", null],
      ]);
    }
    const altered = evaluate({ invoice: { ...INVOICE, intact: false } });
    expect(codes(altered)).toEqual([["DEBIT_NOTE_INVOICE_INTEGRITY", null]]);
    expect(altered.amounts).toBeNull();
  });

  it("una factura de otro ambiente no admite la nota", () => {
    const result = evaluate({ companyEnvironment: "PRODUCTION" });
    expect(codes(result)).toEqual([["DEBIT_NOTE_INVOICE_NOT_ELIGIBLE", null]]);
    expect(result.issues[0]!.message).toMatch(/mismo ambiente/);
  });

  it("consumidor final: política del proyecto, no la NAC-DGERCGC25-00000014, que ninguna declaración evita", () => {
    const result = evaluate({ invoice: { ...INVOICE, consumerFinal: true } });
    expect(codes(result)).toEqual([["DEBIT_NOTE_CONSUMER_FINAL", null]]);
    expect(result.issues[0]!.message).toMatch(/política del sistema/);
    expect(result.issues[0]!.message).not.toMatch(/NAC-DGERCGC25/);
    expect(result.amounts).toBeNull();
  });

  it("una nota sin conceptos no se puede emitir", () => {
    expect(codes(evaluate(request({ concepts: [] })))).toEqual([
      ["DEBIT_NOTE_CONCEPTS_REQUIRED", null],
    ]);
  });

  it("cada campo faltante o inválido se informa con la posición de su concepto", () => {
    const result = evaluate(
      request({
        concepts: [
          CONCEPT,
          { cause: null, description: null, amount: null, taxTreatment: null },
          { ...CONCEPT, amount: "0.00" },
          { ...CONCEPT, amount: "-5.00" },
          { ...CONCEPT, description: "dos\nlíneas" },
          { ...CONCEPT, cause: "PRICE_CORRECTION" as never },
        ],
      }),
    );
    expect(codes(result)).toEqual([
      ["DEBIT_NOTE_DRAFT_INCOMPLETE", 2],
      ["DEBIT_NOTE_DRAFT_INCOMPLETE", 2],
      ["DEBIT_NOTE_DRAFT_INCOMPLETE", 2],
      ["DEBIT_NOTE_DRAFT_INCOMPLETE", 2],
      ["DEBIT_NOTE_CONCEPT_INVALID", 3],
      ["DEBIT_NOTE_CONCEPT_INVALID", 4],
      ["DEBIT_NOTE_CONCEPT_INVALID", 5],
      ["DEBIT_NOTE_CONCEPT_INVALID", 6],
    ]);
    // Con un concepto inválido, la nota no se calcula.
    expect(result.amounts).toBeNull();
    expect(result.payment).toBeNull();
  });

  it("un tratamiento que la factura no tenía se rechaza; nunca una tarifa vigente ajena", () => {
    expect(codes(evaluate(request({ concepts: [{ ...CONCEPT, taxTreatment: "2:2" }] })))).toEqual([
      ["DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE", 1],
    ]);
  });

  it("una factura con varias tarifas nunca se colapsa: cada concepto conserva la suya", () => {
    const result = evaluate({
      invoice: { ...INVOICE, treatments: [IVA_0, IVA_15, EXEMPT] },
      ...request({
        concepts: [
          { ...CONCEPT, amount: "10.00", taxTreatment: "2:4" },
          { ...CONCEPT, cause: "POST_INVOICE_COST_EXPENSE", amount: "5.00", taxTreatment: "2:0" },
          { ...CONCEPT, cause: "POST_INVOICE_COST_EXPENSE", amount: "3.00", taxTreatment: "2:7" },
        ],
      }),
    });
    expect(result.issues).toEqual([]);
    expect(result.amounts?.taxes.map((tax) => [tax.key, tax.base, tax.amount])).toEqual([
      ["2:0", "5.00", "0.00"],
      ["2:4", "10.00", "1.50"],
      ["2:7", "3.00", "0.00"],
    ]);
  });

  it("la descripción no cambia la causa ni los importes", () => {
    const literal = evaluate(
      request({
        concepts: [
          { ...CONCEPT, cause: "POST_INVOICE_COST_EXPENSE", description: "interés por mora" },
        ],
      }),
    );
    expect(literal.concepts[0]!.cause).toBe("POST_INVOICE_COST_EXPENSE");
    expect(literal.amounts).toEqual(evaluate().amounts);
  });

  it("la forma de pago es obligatoria, vigente y habilitada para la empresa", () => {
    const missing = evaluate(request({ payment: null }));
    expect(codes(missing)).toEqual([["DEBIT_NOTE_DRAFT_INCOMPLETE", null]]);
    expect(missing.issues[0]!.message).toMatch(/forma de pago/);
    expect(missing.payment).toBeNull();
    const unusable = evaluate(
      request({ payment: { entryKey: "99", usable: false, version: null } }),
    );
    expect(codes(unusable)).toEqual([["DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE", null]]);
    expect(unusable.payment).toBeNull();
  });

  it("el total de la forma de pago es exactamente el valor total, sin tolerancia", () => {
    expect(paymentCoversTotal({ amount: "23.00" }, "23.00")).toBe(true);
    expect(paymentCoversTotal({ amount: "23" }, "23.00")).toBe(true);
    expect(paymentCoversTotal({ amount: "22.99" }, "23.00")).toBe(false);
    expect(paymentCoversTotal({ amount: "23.001" }, "23.00")).toBe(false);
  });

  it("la declaración se exige en la emisión, con la versión vigente y su afirmación", () => {
    expect(codes(evaluate(request({ declarations: { version: 1, statements: [] } })))).toEqual([
      ["DEBIT_NOTE_DECLARATION_REQUIRED", null],
    ]);
    expect(codes(evaluate(request({ declarations: { ...DECLARATIONS, version: 2 } })))).toEqual([
      ["DEBIT_NOTE_DECLARATION_REQUIRED", null],
    ]);
    // La vista previa no tiene declaración: no la exige.
    expect(evaluate(request({ declarations: undefined })).issues).toEqual([]);
  });

  it("la preparación de la empresa va después de los conceptos, la forma de pago y la declaración", () => {
    const result = evaluate({
      ...request({ payment: null }),
      readiness: [{ code: "SIGNING_CERTIFICATE_NOT_USABLE", message: "Sin firma.", concept: null }],
    });
    expect(codes(result)).toEqual([
      ["DEBIT_NOTE_DRAFT_INCOMPLETE", null],
      ["SIGNING_CERTIFICATE_NOT_USABLE", null],
    ]);
  });

  it("importes que exceden los dígitos del comprobante se rechazan", () => {
    const result = evaluate(
      request({
        concepts: [
          { ...CONCEPT, amount: "999999999999.99" },
          { ...CONCEPT, amount: "999999999999.99" },
        ],
      }),
    );
    expect(codes(result)).toEqual([["DEBIT_NOTE_AMOUNT_OUT_OF_RANGE", null]]);
  });

  it("no hay plazo de emisión: la evaluación no mira la fecha de la factura", () => {
    // La entrada no tiene ninguna fecha: una factura de hace más de doce meses se evalúa igual.
    expect(Object.keys(INVOICE)).not.toContain("issueDate");
    expect(evaluate().issues).toEqual([]);
  });
});

describe("tratamientos de la factura y vista previa", () => {
  const tax = (rateCode: string, percentage: string, taxCode = "2") => ({
    taxCode,
    rateCode,
    catalogType: taxCode === "2" ? "iva-rate" : "ice-rate",
    entryKey: rateCode,
    versionId: `v-${rateCode}`,
    officialLabel: `${percentage}%`,
    percentage,
  });

  it("los tratamientos son los IVA distintos de las líneas, ordenados por código", () => {
    const treatments = invoiceTaxTreatments([
      { taxes: [tax("4", "15")] },
      { taxes: [tax("0", "0")] },
      { taxes: [tax("4", "15"), tax("3011", "0.16", "3")] },
    ]);
    expect(treatments.map((t) => t.key)).toEqual(["2:0", "2:4"]);
    expect(treatments[1]).toMatchObject({ percentage: "15", versionId: "v-4", entryKey: "4" });
  });

  it("un tratamiento con dos porcentajes en la misma factura falla", () => {
    expect(() =>
      invoiceTaxTreatments([{ taxes: [tax("4", "15")] }, { taxes: [tax("4", "12")] }]),
    ).toThrow("dos porcentajes");
  });

  it("la vista previa ofrece solo los tratamientos de la factura y muestra el resultado del cálculo", () => {
    const evaluation = evaluate(
      request({
        concepts: [CONCEPT, { ...CONCEPT, amount: "5.00", taxTreatment: "2:0" }],
        declarations: undefined,
      }),
    );
    const preview = debitNotePreview(INVOICE.treatments, evaluation, "2026-10-09");
    expect(preview.taxTreatments.map((t) => t.key)).toEqual(["2:0", "2:4"]);
    expect(preview.totals).toEqual({
      withoutTaxes: "25.00",
      taxes: [
        {
          key: "2:0",
          taxCode: "2",
          rateCode: "0",
          percentage: "0",
          label: "0%",
          base: "5.00",
          amount: "0.00",
        },
        {
          key: "2:4",
          taxCode: "2",
          rateCode: "4",
          percentage: "15",
          label: "15%",
          base: "20.00",
          amount: "3.00",
        },
      ],
      total: "28.00",
    });
    expect(preview.payment).toEqual({
      entryKey: "01",
      code: "01",
      label: "SIN UTILIZACION DEL SISTEMA FINANCIERO",
      amount: "28.00",
    });
    expect(preview.issues).toEqual([]);
  });

  it("la vista previa muestra los problemas junto a su concepto y sin totales si no se calcula", () => {
    const preview = debitNotePreview(
      INVOICE.treatments,
      evaluate(
        request({ concepts: [{ ...CONCEPT, taxTreatment: "2:2" }], declarations: undefined }),
      ),
      "2026-10-09",
    );
    expect(preview.totals).toBeNull();
    expect(preview.issues.map((found) => [found.code, found.concept])).toEqual([
      ["DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE", 1],
    ]);
  });
});

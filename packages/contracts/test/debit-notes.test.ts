// Contratos de las notas de débito (add-debit-notes, tarea 2.1, design D5, D8, D9 y D20): causas
// cerradas del artículo 16, importes como texto exacto mayor que cero, descripción de una línea,
// tratamientos como clave, una sola forma de pago como clave de catálogo, declaración vigente y
// cuerpos estrictos sin empresa ni comprobantes externos.
import { describe, expect, it } from "vitest";
import {
  DEBIT_NOTE_CAUSES,
  DEBIT_NOTE_CAUSE_LABELS,
  DEBIT_NOTE_CONCEPTS_MAX,
  DEBIT_NOTE_DECLARATION_STATEMENTS,
  DEBIT_NOTE_ELIGIBILITY_DECLARATION,
  DEBIT_NOTE_ERROR_CODES,
  createDebitNoteDraftSchema,
  emitDebitNoteSchema,
  listDebitNotesQuerySchema,
  updateDebitNoteDraftSchema,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

const CONCEPT = {
  cause: "LATE_PAYMENT_INTEREST",
  description: "Intereses por 30 días de mora",
  amount: "20.00",
  taxTreatment: "2:4",
};
const draft = (overrides: Record<string, unknown> = {}) => ({
  invoiceId: "inv-1",
  emissionPointId: "point-1",
  paymentMethod: "01",
  concepts: [CONCEPT],
  ...overrides,
});
const withConcept = (concept: Record<string, unknown>) =>
  draft({ concepts: [{ ...CONCEPT, ...concept }] });

describe("causas y declaración", () => {
  it("dos causas cerradas del artículo 16 con su etiqueta", () => {
    expect(DEBIT_NOTE_CAUSES).toEqual(["LATE_PAYMENT_INTEREST", "POST_INVOICE_COST_EXPENSE"]);
    expect(Object.keys(DEBIT_NOTE_CAUSE_LABELS)).toEqual([...DEBIT_NOTE_CAUSES]);
  });

  it("la política vigente tiene una afirmación de identificador estable, con su texto, contexto y fuente", () => {
    expect(DEBIT_NOTE_ELIGIBILITY_DECLARATION.version).toBe(1);
    expect(DEBIT_NOTE_ELIGIBILITY_DECLARATION.basis).toBe("USER_DECLARED");
    expect(DEBIT_NOTE_DECLARATION_STATEMENTS).toEqual([
      "NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE",
    ]);
    expect(DEBIT_NOTE_ELIGIBILITY_DECLARATION.statements.map((s) => s.id)).toEqual([
      ...DEBIT_NOTE_DECLARATION_STATEMENTS,
    ]);
    for (const statement of DEBIT_NOTE_ELIGIBILITY_DECLARATION.statements) {
      expect(statement.text.length).toBeGreaterThan(20);
      expect(statement.context.length).toBeGreaterThan(20);
      expect(statement.source).toMatch(/art\. 16/);
    }
  });

  it("los códigos de error de design D20", () => {
    expect(DEBIT_NOTE_ERROR_CODES).toEqual(
      expect.arrayContaining([
        "DEBIT_NOTE_INVOICE_NOT_ELIGIBLE",
        "DEBIT_NOTE_INVOICE_INTEGRITY",
        "DEBIT_NOTE_CONSUMER_FINAL",
        "DEBIT_NOTE_CONCEPTS_REQUIRED",
        "DEBIT_NOTE_CONCEPTS_TOO_MANY",
        "DEBIT_NOTE_CONCEPT_INVALID",
        "DEBIT_NOTE_TAX_TREATMENT_NOT_IN_INVOICE",
        "DEBIT_NOTE_PAYMENT_METHOD_NOT_USABLE",
        "DEBIT_NOTE_PAYMENT_TOTAL_MISMATCH",
        "DEBIT_NOTE_AMOUNT_OUT_OF_RANGE",
        "DEBIT_NOTE_DECLARATION_REQUIRED",
        "DEBIT_NOTE_DRAFT_INCOMPLETE",
        "DEBIT_NOTE_DRAFT_CHANGED",
        "DEBIT_NOTE_DRAFT_ALREADY_EMITTED",
        "DEBIT_NOTE_NOT_RECONCILABLE",
        "IDEMPOTENCY_KEY_REQUIRED",
        "IDEMPOTENCY_KEY_REUSED",
      ]),
    );
  });
});

describe("borrador de la nota de débito", () => {
  it("acepta un borrador completo y uno incompleto", () => {
    expect(createDebitNoteDraftSchema.parse(draft())).toEqual(draft());
    expect(createDebitNoteDraftSchema.parse({ invoiceId: "inv-1" })).toEqual({
      invoiceId: "inv-1",
      emissionPointId: null,
      paymentMethod: null,
      concepts: [],
    });
    expect(createDebitNoteDraftSchema.parse(draft({ concepts: [{}] })).concepts).toEqual([
      { cause: null, description: null, amount: null, taxTreatment: null },
    ]);
  });

  it("rechaza una causa desconocida, como una corrección de precio o una penalidad", () => {
    for (const cause of ["PRICE_CORRECTION", "PENALTY", "late_payment_interest", ""]) {
      expect(messages(createDebitNoteDraftSchema.safeParse(withConcept({ cause })))).toContain(
        "La causa debe ser intereses de mora o costos o gastos posteriores a la factura.",
      );
    }
  });

  it("rechaza importes como número, con 3 decimales, en cero o negativos", () => {
    for (const amount of [20, "10.005", "0", "0.00", "-5.00", "1e2", "1000000000000.00"]) {
      expect(
        createDebitNoteDraftSchema.safeParse(withConcept({ amount })).success,
        String(amount),
      ).toBe(false);
    }
    expect(
      messages(createDebitNoteDraftSchema.safeParse(withConcept({ amount: "0.00" }))),
    ).toContain("El importe del concepto debe ser mayor que cero.");
    expect(
      createDebitNoteDraftSchema.parse(withConcept({ amount: "0.01" })).concepts[0],
    ).toMatchObject({ amount: "0.01" });
  });

  it("rechaza una descripción vacía, de varias líneas o de más de 300 caracteres", () => {
    for (const description of ["", "   ", "Primera\nsegunda", "x".repeat(301)]) {
      expect(
        createDebitNoteDraftSchema.safeParse(withConcept({ description })).success,
        JSON.stringify(description),
      ).toBe(false);
    }
    expect(
      createDebitNoteDraftSchema.parse(withConcept({ description: "x".repeat(300) })).concepts[0]!
        .description,
    ).toHaveLength(300);
  });

  it("rechaza un tratamiento que no es una clave taxCode:rateCode", () => {
    for (const taxTreatment of ["IVA 15%", "15", "2:", ":4", "2:4:1", 4]) {
      expect(createDebitNoteDraftSchema.safeParse(withConcept({ taxTreatment })).success).toBe(
        false,
      );
    }
  });

  it("rechaza más conceptos que el máximo del producto", () => {
    const concepts = Array.from({ length: DEBIT_NOTE_CONCEPTS_MAX + 1 }, () => CONCEPT);
    expect(messages(createDebitNoteDraftSchema.safeParse(draft({ concepts })))).toContain(
      `La nota admite como máximo ${DEBIT_NOTE_CONCEPTS_MAX} conceptos.`,
    );
    expect(
      createDebitNoteDraftSchema.safeParse(draft({ concepts: concepts.slice(1) })).success,
    ).toBe(true);
  });

  it("acepta una sola forma de pago como clave del catálogo, sin etiqueta, importe ni lista", () => {
    for (const paymentMethod of [
      "01 - SIN UTILIZACION DEL SISTEMA FINANCIERO",
      "efectivo",
      ["01", "20"],
      { code: "01", label: "Efectivo" },
      1,
    ]) {
      expect(
        createDebitNoteDraftSchema.safeParse(draft({ paymentMethod })).success,
        JSON.stringify(paymentMethod),
      ).toBe(false);
    }
    for (const extra of [
      { payments: [{ paymentMethod: "01", amount: "23.00" }] },
      { paymentAmount: "23.00" },
      { paymentLabel: "Efectivo" },
    ]) {
      expect(messages(createDebitNoteDraftSchema.safeParse(draft(extra)))).toContain(
        "La solicitud contiene campos no permitidos.",
      );
    }
  });

  it("rechaza un companyId, un comprobante externo o importes calculados en el cuerpo", () => {
    for (const extra of [
      { companyId: "otra" },
      { invoiceNumber: "001-001-000000001" },
      { invoiceAccessKey: "0".repeat(49) },
      { invoiceDate: "2026-10-01" },
      { documentType: "03" },
      { total: "23.00" },
    ]) {
      expect(messages(createDebitNoteDraftSchema.safeParse(draft(extra)))).toContain(
        "La solicitud contiene campos no permitidos.",
      );
    }
    expect(
      createDebitNoteDraftSchema.safeParse(withConcept({ tax: "3.00", percentage: "15" })).success,
    ).toBe(false);
    // La factura de un borrador no cambia: otra factura es otro borrador.
    expect(
      messages(updateDebitNoteDraftSchema.safeParse({ ...draft(), expectedVersion: 1 })),
    ).toContain("La solicitud contiene campos no permitidos.");
    const { invoiceId: _invoice, ...rest } = draft();
    expect(updateDebitNoteDraftSchema.safeParse({ ...rest, expectedVersion: 1 }).success).toBe(
      true,
    );
    expect(updateDebitNoteDraftSchema.safeParse(rest).success).toBe(false);
  });
});

describe("emisión de la nota de débito", () => {
  const DECLARATIONS = {
    version: 1,
    statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"],
  };

  it("exige el borrador, su versión y la declaración vigente", () => {
    expect(
      emitDebitNoteSchema.parse({ draftId: "d-1", expectedVersion: 2, declarations: DECLARATIONS }),
    ).toEqual({ draftId: "d-1", expectedVersion: 2, declarations: DECLARATIONS });
  });

  it("rechaza la declaración faltante, de otra versión, vacía o con otra afirmación", () => {
    for (const declarations of [
      undefined,
      { ...DECLARATIONS, version: 2 },
      { version: 1, statements: [] },
      { version: 1, statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE"] },
      { ...DECLARATIONS, basis: "SYSTEM_VERIFIED" },
    ]) {
      expect(
        emitDebitNoteSchema.safeParse({ draftId: "d-1", expectedVersion: 1, declarations }).success,
        JSON.stringify(declarations),
      ).toBe(false);
    }
  });

  it("rechaza un companyId o datos de la nota en el cuerpo de la emisión", () => {
    for (const extra of [{ companyId: "otra" }, { paymentMethod: "01" }, { concepts: [] }]) {
      expect(
        messages(
          emitDebitNoteSchema.safeParse({
            draftId: "d-1",
            expectedVersion: 1,
            declarations: DECLARATIONS,
            ...extra,
          }),
        ),
      ).toContain("La solicitud contiene campos no permitidos.");
    }
  });
});

describe("consultas", () => {
  it("la lista filtra por estado y causa e ignora un companyId", () => {
    expect(
      listDebitNotesQuerySchema.parse({
        state: "AUTHORIZED",
        cause: "POST_INVOICE_COST_EXPENSE",
        companyId: "otra",
      }),
    ).toMatchObject({ state: "AUTHORIZED", cause: "POST_INVOICE_COST_EXPENSE" });
    expect(listDebitNotesQuerySchema.safeParse({ cause: "RETURN" }).success).toBe(false);
  });
});

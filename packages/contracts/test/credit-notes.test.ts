// Contratos de las notas de crédito (add-credit-notes, tarea 3.1, design D5, D9 y D16): causas
// cerradas, cantidades como texto exacto, retorno físico acotado, motivo de una línea, declaraciones
// completas de la versión vigente y cuerpos estrictos sin empresa ni comprobantes externos.
import { describe, expect, it } from "vitest";
import {
  CREDIT_NOTE_CAUSES,
  CREDIT_NOTE_CAUSE_LABELS,
  CREDIT_NOTE_DECLARATION_STATEMENTS,
  CREDIT_NOTE_ELIGIBILITY_DECLARATION,
  CREDIT_NOTE_ERROR_CODES,
  createCreditNoteDraftSchema,
  emitCreditNoteSchema,
  listCreditNotesQuerySchema,
  updateCreditNoteDraftSchema,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};
const draft = (overrides: Record<string, unknown> = {}) => ({
  invoiceId: "inv-1",
  cause: "RETURN",
  reason: "Devolución de mercadería",
  lines: [{ position: 1, quantity: "2", physicalReturn: "1" }],
  ...overrides,
});

describe("causas y declaraciones", () => {
  it("dos causas cerradas con su etiqueta", () => {
    expect(CREDIT_NOTE_CAUSES).toEqual(["TOTAL_ANNULMENT", "RETURN"]);
    expect(Object.keys(CREDIT_NOTE_CAUSE_LABELS)).toEqual([...CREDIT_NOTE_CAUSES]);
  });

  it("la política vigente tiene dos afirmaciones de identificador estable, con su texto, contexto y fuente", () => {
    expect(CREDIT_NOTE_ELIGIBILITY_DECLARATION.version).toBe(1);
    expect(CREDIT_NOTE_ELIGIBILITY_DECLARATION.basis).toBe("USER_DECLARED");
    expect(CREDIT_NOTE_ELIGIBILITY_DECLARATION.statements.map((s) => s.id)).toEqual([
      ...CREDIT_NOTE_DECLARATION_STATEMENTS,
    ]);
    for (const statement of CREDIT_NOTE_ELIGIBILITY_DECLARATION.statements) {
      expect(statement.text.length).toBeGreaterThan(20);
      expect(statement.context.length).toBeGreaterThan(20);
      expect(statement.source).toMatch(/NAC-DGERCGC25-00000014/);
    }
  });

  it("los códigos de error de design D16", () => {
    expect(CREDIT_NOTE_ERROR_CODES).toEqual(
      expect.arrayContaining([
        "CREDIT_NOTE_INVOICE_NOT_ELIGIBLE",
        "CREDIT_NOTE_CONSUMER_FINAL",
        "CREDIT_NOTE_INVOICE_INTEGRITY",
        "CREDIT_NOTE_CAUSE_INVALID",
        "CREDIT_NOTE_LINE_INVALID",
        "CREDIT_NOTE_QUANTITY_EXCEEDED",
        "CREDIT_NOTE_AMOUNT_EXCEEDED",
        "CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE",
        "CREDIT_NOTE_PHYSICAL_RETURN_INVALID",
        "CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED",
        "CREDIT_NOTE_LINE_AMOUNT_NEGATIVE",
        "CREDIT_NOTE_DECLARATIONS_REQUIRED",
        "CREDIT_NOTE_DRAFT_CHANGED",
        "IDEMPOTENCY_KEY_REQUIRED",
        "IDEMPOTENCY_KEY_REUSED",
      ]),
    );
  });
});

describe("borrador de la nota", () => {
  it("acepta una devolución y una anulación total con retorno físico por línea", () => {
    expect(createCreditNoteDraftSchema.parse(draft())).toEqual({
      invoiceId: "inv-1",
      emissionPointId: null,
      cause: "RETURN",
      reason: "Devolución de mercadería",
      lines: [{ position: 1, quantity: "2", physicalReturn: "1" }],
    });
    expect(
      createCreditNoteDraftSchema.parse(
        draft({
          cause: "TOTAL_ANNULMENT",
          reason: null,
          lines: [{ position: 1, physicalReturn: "3" }],
        }),
      ),
    ).toMatchObject({
      cause: "TOTAL_ANNULMENT",
      reason: null,
      lines: [{ position: 1, physicalReturn: "3" }],
    });
    // Sin retorno físico declarado, es cero: nunca se asume un retorno.
    expect(
      createCreditNoteDraftSchema.parse(draft({ lines: [{ position: 1, quantity: "2" }] })).lines,
    ).toEqual([{ position: 1, quantity: "2", physicalReturn: "0" }]);
  });

  it("rechaza una causa desconocida, como un descuento o una bonificación", () => {
    for (const cause of ["DISCOUNT", "BONUS", "return", ""]) {
      const result = createCreditNoteDraftSchema.safeParse(draft({ cause }));
      expect(messages(result)).toContain("La causa debe ser anulación total o devolución.");
    }
  });

  it("rechaza cantidades como número, con 7 decimales, cero o negativas", () => {
    for (const quantity of [2, "1.0000001", "0", "0.000000", "-1", "1e2"]) {
      const result = createCreditNoteDraftSchema.safeParse(
        draft({ lines: [{ position: 1, quantity, physicalReturn: "0" }] }),
      );
      expect(result.success, String(quantity)).toBe(false);
    }
  });

  it("rechaza un retorno físico mayor que lo acreditado o con formato inválido", () => {
    expect(
      messages(
        createCreditNoteDraftSchema.safeParse(
          draft({ lines: [{ position: 1, quantity: "2", physicalReturn: "3" }] }),
        ),
      ),
    ).toContain("El retorno físico no puede superar la cantidad acreditada.");
    for (const physicalReturn of [1, "-1", "0.1234567"]) {
      expect(
        createCreditNoteDraftSchema.safeParse(
          draft({ lines: [{ position: 1, quantity: "2", physicalReturn }] }),
        ).success,
      ).toBe(false);
    }
  });

  it("rechaza la misma línea dos veces, una línea sin posición y cantidades en una anulación total", () => {
    expect(
      messages(
        createCreditNoteDraftSchema.safeParse(
          draft({
            lines: [
              { position: 1, quantity: "1" },
              { position: 1, quantity: "1" },
            ],
          }),
        ),
      ),
    ).toContain("La misma línea de la factura aparece dos veces.");
    expect(
      createCreditNoteDraftSchema.safeParse(draft({ lines: [{ quantity: "1" }] })).success,
    ).toBe(false);
    expect(
      createCreditNoteDraftSchema.safeParse(draft({ lines: [{ position: 0, quantity: "1" }] }))
        .success,
    ).toBe(false);
    expect(
      messages(
        createCreditNoteDraftSchema.safeParse(
          draft({ cause: "TOTAL_ANNULMENT", lines: [{ position: 1, quantity: "3" }] }),
        ),
      ),
    ).toContain("Una anulación total acredita las cantidades completas: no se eligen.");
    expect(
      messages(
        createCreditNoteDraftSchema.safeParse(
          draft({ lines: [{ position: 1, physicalReturn: "0" }] }),
        ),
      ),
    ).toContain("Indica la cantidad acreditada de la línea.");
  });

  it("rechaza un motivo vacío, de varias líneas o de más de 300 caracteres", () => {
    for (const reason of ["", "   ", "Primera\nsegunda", "x".repeat(301)]) {
      expect(
        createCreditNoteDraftSchema.safeParse(draft({ reason })).success,
        JSON.stringify(reason),
      ).toBe(false);
    }
    expect(
      createCreditNoteDraftSchema.parse(draft({ reason: "x".repeat(300) })).reason,
    ).toHaveLength(300);
  });

  it("rechaza un companyId, un comprobante externo o importes en el cuerpo", () => {
    for (const extra of [
      { companyId: "otra" },
      { invoiceNumber: "001-001-000000001" },
      { invoiceAccessKey: "0".repeat(49) },
      { invoiceDate: "2026-10-01" },
      { total: "10.00" },
    ]) {
      expect(messages(createCreditNoteDraftSchema.safeParse(draft(extra)))).toContain(
        "La solicitud contiene campos no permitidos.",
      );
    }
    expect(
      createCreditNoteDraftSchema.safeParse(
        draft({ lines: [{ position: 1, quantity: "1", unitPrice: "5" }] }),
      ).success,
    ).toBe(false);
    // La factura de un borrador no cambia: otra factura es otro borrador.
    expect(
      messages(updateCreditNoteDraftSchema.safeParse({ ...draft(), expectedVersion: 1 })),
    ).toContain("La solicitud contiene campos no permitidos.");
  });
});

describe("emisión de la nota", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    draftId: "d-1",
    expectedVersion: 1,
    declarations: DECLARATIONS,
    ...overrides,
  });

  it("acepta las dos declaraciones de la versión vigente", () => {
    expect(emitCreditNoteSchema.parse(body())).toEqual(body());
    expect(
      emitCreditNoteSchema.parse(
        body({ declarations: { version: 1, statements: [...DECLARATIONS.statements].reverse() } }),
      ).declarations.statements,
    ).toHaveLength(2);
  });

  it("rechaza las declaraciones faltantes, incompletas, repetidas, desconocidas o de otra versión", () => {
    for (const declarations of [
      undefined,
      null,
      { version: 1, statements: [] },
      { version: 1, statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE"] },
      { version: 1, statements: ["NOT_TAX_REFUND_SUPPORT", "NOT_TAX_REFUND_SUPPORT"] },
      { version: 1, statements: [...DECLARATIONS.statements, "SYSTEM_VERIFIED"] },
      { version: 2, statements: DECLARATIONS.statements },
      { statements: DECLARATIONS.statements },
      { ...DECLARATIONS, basis: "SYSTEM_VERIFIED" },
    ]) {
      expect(
        emitCreditNoteSchema.safeParse(body({ declarations })).success,
        JSON.stringify(declarations),
      ).toBe(false);
    }
    expect(
      messages(
        emitCreditNoteSchema.safeParse(
          body({ declarations: { version: 2, statements: DECLARATIONS.statements } }),
        ),
      ),
    ).toContain("La declaración no es la vigente: vuelve a confirmarla.");
  });

  it("rechaza un companyId o una versión del borrador inválida", () => {
    expect(messages(emitCreditNoteSchema.safeParse(body({ companyId: "otra" })))).toContain(
      "La solicitud contiene campos no permitidos.",
    );
    for (const expectedVersion of [0, "1", 1.5, undefined]) {
      expect(emitCreditNoteSchema.safeParse(body({ expectedVersion })).success).toBe(false);
    }
  });
});

describe("consultas", () => {
  it("no son estrictas: un companyId se ignora; la causa y el estado se validan", () => {
    expect(listCreditNotesQuerySchema.parse({ companyId: "x", cause: "RETURN" })).toMatchObject({
      cause: "RETURN",
      page: 1,
    });
    expect(listCreditNotesQuerySchema.safeParse({ cause: "DISCOUNT" }).success).toBe(false);
    expect(listCreditNotesQuerySchema.safeParse({ state: "PAID" }).success).toBe(false);
  });
});

// Reglas de elegibilidad y de líneas de la nota de crédito (add-credit-notes, tarea 5.2, design D4,
// D5, D9 y D10) y su vista previa pura: cada rechazo en el orden de D4, la anulación total que copia
// la factura, el retorno físico por línea independiente de lo acreditable y las declaraciones.
import { creditNotePreviewViewSchema, type CreditNoteIssue } from "@facturador/contracts";
import { describe, expect, it } from "vitest";
import type { CreditedLine } from "../../src/modules/credit-notes/domain/amounts.ts";
import {
  availableReturn,
  evaluateCreditNote,
  type CreditInvoice,
  type CreditInvoiceLine,
  type CreditNoteEvaluationInput,
  type CreditNoteRequest,
} from "../../src/modules/credit-notes/domain/evaluation.ts";
import { creditNotePreview } from "../../src/modules/credit-notes/domain/preview.ts";
import { lineAmounts } from "../../src/modules/invoices/domain/amounts.ts";

const IVA15 = { taxCode: "2", rateCode: "4", percentage: "15" };

function line(
  position: number,
  productId: string,
  quantity: string,
  unitPrice: string,
  discount: string,
  inventoryAffectsStock: boolean,
): CreditInvoiceLine {
  const amounts = lineAmounts({ quantity, unitPrice, discount, taxes: [IVA15] });
  return {
    position,
    productId,
    mainCode: `P-${position}`,
    auxiliaryCode: null,
    description: `Producto ${position}`,
    quantity,
    unitPrice,
    subtotal: amounts.subtotal,
    discount: amounts.discount,
    taxableBase: amounts.taxableBase,
    taxes: amounts.taxes.map(({ taxCode, rateCode, percentage, amount }) => ({
      taxCode,
      rateCode,
      percentage,
      amount,
    })),
    inventoryAffectsStock,
  };
}

// Factura de 28.75 + otra línea: un bien con inventario (10 × 10.00) y un servicio.
const GOOD = line(1, "prod-good", "10", "10.00", "0.00", true);
const SERVICE = line(2, "prod-service", "1", "15.00", "0.00", false);
const INVOICE: CreditInvoice = {
  state: "AUTHORIZED",
  intact: true,
  consumerFinal: false,
  total: "132.25",
  lines: [GOOD, SERVICE],
};
const NO_CREDIT = { reserved: "0", applied: "0", credited: [] as CreditedLine[] };
const DECLARATIONS = {
  version: 1,
  statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
};
const RETURN: CreditNoteRequest = {
  cause: "RETURN",
  reason: "Devolución de mercadería",
  lines: [{ position: 1, quantity: "5", physicalReturn: "2" }],
  declarations: DECLARATIONS,
};

const evaluate = (overrides: Partial<CreditNoteEvaluationInput> = {}) =>
  evaluateCreditNote({
    invoice: INVOICE,
    credit: NO_CREDIT,
    returnable: new Map([["prod-good", "10"]]),
    request: RETURN,
    ...overrides,
  });
const codes = (issues: readonly CreditNoteIssue[]) => issues.map((i) => [i.code, i.line]);

describe("condiciones de la factura, en el orden de design D4", () => {
  it("una factura no autorizada se rechaza antes que todo lo demás", () => {
    for (const state of [
      "RESERVED",
      "SIGNED",
      "RECEIVED",
      "SEND_UNKNOWN",
      "MANUAL_REVIEW",
      "RETURNED",
      "NOT_AUTHORIZED",
    ]) {
      const result = evaluate({
        invoice: { ...INVOICE, state, consumerFinal: true, intact: false },
        request: { ...RETURN, cause: "DISCOUNT", reason: null },
      });
      expect(codes(result.issues), state).toEqual([["CREDIT_NOTE_INVOICE_NOT_ELIGIBLE", null]]);
      expect(result.amounts).toBeNull();
    }
  });

  it("una factura alterada se rechaza y no se calcula ni repara nada", () => {
    const result = evaluate({ invoice: { ...INVOICE, intact: false, consumerFinal: true } });
    expect(codes(result.issues)).toEqual([["CREDIT_NOTE_INVOICE_INTEGRITY", null]]);
    expect(result.amounts).toBeNull();
  });

  it("una factura a consumidor final se rechaza aunque el usuario confirme las declaraciones", () => {
    const result = evaluate({ invoice: { ...INVOICE, consumerFinal: true } });
    expect(codes(result.issues)).toEqual([["CREDIT_NOTE_CONSUMER_FINAL", null]]);
    expect(result.issues[0]!.message).toMatch(/NAC-DGERCGC25-00000014/);
  });

  it("una causa desconocida se rechaza; un motivo que nombra otra causa no cambia la causa", () => {
    expect(codes(evaluate({ request: { ...RETURN, cause: "DISCOUNT" } }).issues)).toEqual([
      ["CREDIT_NOTE_CAUSE_INVALID", null],
    ]);
    const named = evaluate({ request: { ...RETURN, reason: "Descuento por pronto pago" } });
    expect(named.issues).toEqual([]);
    expect(named.lines).toEqual([{ position: 1, quantity: "5", physicalReturn: "2" }]);
  });

  it("sin motivo, con más de 300 caracteres o de varias líneas, la nota no se emite", () => {
    for (const reason of [null, "", "  ", "x".repeat(301), "uno\ndos", "uno\rdos"]) {
      expect(codes(evaluate({ request: { ...RETURN, reason } }).issues), String(reason)).toEqual([
        ["CREDIT_NOTE_REASON_REQUIRED", null],
      ]);
    }
  });

  it("informa todos los problemas a la vez, en el orden de D4, con la preparación antes del cálculo", () => {
    const result = evaluate({
      credit: {
        reserved: "57.50",
        applied: "0",
        credited: [credited(1, "5", "50", "0.00", "50.00", "7.50")],
      },
      request: {
        cause: "RETURN",
        reason: null,
        lines: [
          { position: 9, quantity: "1", physicalReturn: "0" },
          { position: 2, quantity: "1", physicalReturn: "1" },
          { position: 1, quantity: "6", physicalReturn: "0" },
        ],
        declarations: { version: 1, statements: ["NOT_TAX_REFUND_SUPPORT"] },
      },
      readiness: [{ code: "SIGNING_CERTIFICATE_NOT_USABLE", message: "Firma", line: null }],
    });
    expect(codes(result.issues)).toEqual([
      ["CREDIT_NOTE_REASON_REQUIRED", null],
      ["CREDIT_NOTE_LINE_INVALID", 9],
      ["CREDIT_NOTE_PHYSICAL_RETURN_INVALID", 2],
      ["CREDIT_NOTE_DECLARATIONS_REQUIRED", null],
      ["SIGNING_CERTIFICATE_NOT_USABLE", null],
      ["CREDIT_NOTE_QUANTITY_EXCEEDED", 1],
    ]);
    expect(result.issues.at(-1)!.message).toContain("quedan 5");
  });
});

const credited = (
  position: number,
  quantity: string,
  subtotal: string,
  discount: string,
  taxableBase: string,
  tax: string,
): CreditedLine => ({
  position,
  quantity,
  subtotal,
  discount,
  taxableBase,
  taxes: [{ taxCode: "2", rateCode: "4", amount: tax }],
});

describe("devolución por líneas", () => {
  it("rechaza una devolución sin líneas, una línea ajena, repetida, sin cantidad o en cero", () => {
    expect(codes(evaluate({ request: { ...RETURN, lines: [] } }).issues)).toEqual([
      ["CREDIT_NOTE_LINE_INVALID", null],
    ]);
    const result = evaluate({
      request: {
        ...RETURN,
        lines: [
          { position: 3, quantity: "1", physicalReturn: "0" },
          { position: 1, quantity: "1", physicalReturn: "0" },
          { position: 1, quantity: "1", physicalReturn: "0" },
          { position: 2, physicalReturn: "0" },
        ],
      },
    });
    expect(codes(result.issues)).toEqual([
      ["CREDIT_NOTE_LINE_INVALID", 3],
      ["CREDIT_NOTE_LINE_INVALID", 1],
      ["CREDIT_NOTE_LINE_INVALID", 2],
    ]);
    expect(
      codes(
        evaluate({
          request: { ...RETURN, lines: [{ position: 1, quantity: "0", physicalReturn: "0" }] },
        }).issues,
      ),
    ).toEqual([["CREDIT_NOTE_LINE_INVALID", 1]]);
  });

  it("una devolución de todas las líneas completas acredita el total de la factura", () => {
    const result = evaluate({
      request: {
        ...RETURN,
        lines: [
          { position: 1, quantity: "10", physicalReturn: "0" },
          { position: 2, quantity: "1", physicalReturn: "0" },
        ],
      },
    });
    expect(result.issues).toEqual([]);
    expect(result.amounts!.totals!.total).toBe("132.25");
  });
});

describe("anulación total", () => {
  const annulment: CreditNoteRequest = { ...RETURN, cause: "TOTAL_ANNULMENT", lines: [] };

  it("copia la factura con las cantidades completas y sin retorno asumido", () => {
    const result = evaluate({ request: annulment });
    expect(result.issues).toEqual([]);
    expect(result.lines).toEqual([
      { position: 1, quantity: "10", physicalReturn: "0" },
      { position: 2, quantity: "1", physicalReturn: "0" },
    ]);
    expect(result.amounts!.totals!.total).toBe("132.25");
  });

  it("no admite elegir cantidades", () => {
    const result = evaluate({
      request: { ...annulment, lines: [{ position: 1, quantity: "3", physicalReturn: "0" }] },
    });
    expect(codes(result.issues)).toEqual([["CREDIT_NOTE_LINE_INVALID", 1]]);
  });

  it("acepta un retorno físico de 0 a la cantidad original solo en los bienes que afectaban al inventario", () => {
    for (const physicalReturn of ["0", "4", "10"]) {
      const result = evaluate({
        request: { ...annulment, lines: [{ position: 1, physicalReturn }] },
      });
      expect(result.issues, physicalReturn).toEqual([]);
    }
    expect(
      codes(
        evaluate({ request: { ...annulment, lines: [{ position: 1, physicalReturn: "11" }] } })
          .issues,
      ),
    ).toEqual([["CREDIT_NOTE_PHYSICAL_RETURN_INVALID", 1]]);
    expect(
      codes(
        evaluate({ request: { ...annulment, lines: [{ position: 2, physicalReturn: "1" }] } })
          .issues,
      ),
    ).toEqual([["CREDIT_NOTE_PHYSICAL_RETURN_INVALID", 2]]);
  });

  it("procede solo sin crédito reservado ni aplicado, aunque quede casi todo el importe", () => {
    const reserved = evaluate({
      request: annulment,
      credit: {
        reserved: "11.50",
        applied: "0",
        credited: [credited(1, "1", "10", "0.00", "10.00", "1.50")],
      },
    });
    expect(codes(reserved.issues)).toEqual([["CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE", null]]);
    expect(reserved.amounts).toBeNull();
    const applied = evaluate({
      request: annulment,
      credit: {
        reserved: "0",
        applied: "0.50",
        credited: [credited(1, "0.05", "0.5", "0.00", "0.50", "0.08")],
      },
    });
    expect(codes(applied.issues)).toEqual([["CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE", null]]);
  });
});

describe("retorno físico", () => {
  it("un retorno de 0 no devuelve stock y uno mayor que lo acreditado se rechaza", () => {
    expect(
      evaluate({
        request: { ...RETURN, lines: [{ position: 1, quantity: "3", physicalReturn: "0" }] },
      }).issues,
    ).toEqual([]);
    expect(
      codes(
        evaluate({
          request: { ...RETURN, lines: [{ position: 1, quantity: "2", physicalReturn: "3" }] },
        }).issues,
      ),
    ).toEqual([["CREDIT_NOTE_PHYSICAL_RETURN_INVALID", 1]]);
  });

  it("un servicio o un bien que no afectaba al inventario solo se acredita con retorno 0", () => {
    expect(
      codes(
        evaluate({
          request: { ...RETURN, lines: [{ position: 2, quantity: "1", physicalReturn: "1" }] },
        }).issues,
      ),
    ).toEqual([["CREDIT_NOTE_PHYSICAL_RETURN_INVALID", 2]]);
    expect(
      evaluate({
        request: { ...RETURN, lines: [{ position: 2, quantity: "1", physicalReturn: "0" }] },
      }).issues,
    ).toEqual([]);
  });

  it("se limita por producto a lo que queda de la salida, sin derivarse de lo acreditable", () => {
    // Factura de 10 con salida de 10; una nota autorizada acreditó 5 con retorno 2: quedan 5
    // acreditables y 8 devolvibles.
    const credit = {
      reserved: "0",
      applied: "57.50",
      credited: [credited(1, "5", "50", "0.00", "50.00", "7.50")],
    };
    const returnable = new Map([["prod-good", availableReturn("10", "2", "0")]]);
    expect(returnable.get("prod-good")).toBe("8");
    expect(
      evaluate({
        credit,
        returnable,
        request: { ...RETURN, lines: [{ position: 1, quantity: "5", physicalReturn: "5" }] },
      }).issues,
    ).toEqual([]);
    const exceeded = evaluate({
      credit,
      returnable: new Map([["prod-good", "3"]]),
      request: { ...RETURN, lines: [{ position: 1, quantity: "5", physicalReturn: "4" }] },
    });
    expect(codes(exceeded.issues)).toEqual([["CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED", 1]]);
    expect(exceeded.issues[0]!.message).toContain("quedan 3");
    // Sin salida de ese producto, la capacidad devolvible es cero.
    expect(
      codes(
        evaluate({
          returnable: new Map(),
          request: { ...RETURN, lines: [{ position: 1, quantity: "1", physicalReturn: "1" }] },
        }).issues,
      ),
    ).toEqual([["CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED", 1]]);
  });
});

describe("declaraciones", () => {
  it("la vista previa no las exige; la emisión exige las dos de la versión vigente", () => {
    expect(evaluate({ request: { ...RETURN, declarations: undefined } }).issues).toEqual([]);
    for (const declarations of [
      { version: 1, statements: [] },
      { version: 1, statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE"] },
      { version: 2, statements: DECLARATIONS.statements },
      { version: 1, statements: [...DECLARATIONS.statements, "SYSTEM_VERIFIED"] },
    ]) {
      expect(codes(evaluate({ request: { ...RETURN, declarations } }).issues)).toEqual([
        ["CREDIT_NOTE_DECLARATIONS_REQUIRED", null],
      ]);
    }
  });
});

describe("vista previa", () => {
  it("muestra los importes del cálculo único, lo acreditable que queda y el retorno permitido", () => {
    const evaluation = evaluate({
      request: {
        ...RETURN,
        declarations: undefined,
        lines: [
          { position: 1, quantity: "2", physicalReturn: "1" },
          { position: 2, quantity: "1", physicalReturn: "0" },
        ],
      },
    });
    const preview = creditNotePreview(INVOICE, evaluation, "2026-10-05");
    expect(creditNotePreviewViewSchema.parse(preview)).toEqual(preview);
    expect(
      preview.lines.map((l) => [
        l.position,
        l.quantity,
        l.taxableBase,
        l.physicalReturnAllowed,
        l.remainingQuantity,
      ]),
    ).toEqual([
      [1, "2", "20.00", true, "8"],
      [2, "1", "15.00", false, "0"],
    ]);
    expect(preview.totals).toEqual({
      withoutTaxes: "35.00",
      taxes: [{ ...IVA15, base: "35.00", amount: "5.25" }],
      total: "40.25",
    });
    expect(preview.lines[0]!.taxableBase).toBe(evaluation.amounts!.lines[0]!.taxableBase);
  });

  it("con un problema, lista los problemas junto a su línea y no muestra totales", () => {
    const evaluation = evaluate({
      request: { ...RETURN, lines: [{ position: 1, quantity: "11", physicalReturn: "0" }] },
    });
    const preview = creditNotePreview(INVOICE, evaluation, "2026-10-05");
    expect(preview.totals).toBeNull();
    expect(codes(preview.issues)).toEqual([["CREDIT_NOTE_QUANTITY_EXCEEDED", 1]]);
  });
});

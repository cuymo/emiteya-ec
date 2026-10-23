// Contratos de borradores y facturas (add-invoice-emission, tarea 4.1, design D2, D8 y D13).
import { describe, expect, it } from "vitest";
import {
  INVOICE_ERROR_CODES,
  INVOICE_LINES_MAX,
  INVOICE_STATES,
  INVOICE_STATE_LABELS,
  RECONCILABLE_STATES,
  SIGNING_ATTEMPT_CODES,
  apiRoutes,
  invoiceTransmissionSummarySchema,
  invoiceTransmissionViewSchema,
  requestReconciliationSchema,
  createDraftSchema,
  emitInvoiceHeadersSchema,
  emitInvoiceSchema,
  listInvoicesQuerySchema,
  updateDraftSchema,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

const line = { productId: "p-1", quantity: "3", discount: "1.25" };
const draft = {
  emissionPointId: "ep-1",
  buyerPartyId: "party-1",
  lines: [line],
  payments: [{ paymentMethod: "01" }],
};

describe("contrato de borradores de factura", () => {
  it("acepta un borrador completo y normaliza los opcionales", () => {
    expect(createDraftSchema.parse(draft)).toEqual({
      ...draft,
      payments: [{ paymentMethod: "01", amount: null }],
    });
    expect(createDraftSchema.parse({ lines: [{ productId: "p-1", quantity: "1" }] })).toEqual({
      emissionPointId: null,
      buyerPartyId: null,
      lines: [{ productId: "p-1", quantity: "1", discount: "0" }],
      payments: [],
    });
  });

  it("un borrador vacío se puede guardar: la emisión exigirá lo que falte", () => {
    expect(createDraftSchema.parse({})).toEqual({
      emissionPointId: null,
      buyerPartyId: null,
      lines: [],
      payments: [],
    });
  });

  it("rechaza companyId, campos desconocidos y un precio en la línea", () => {
    for (const body of [
      { ...draft, companyId: "otra" },
      { ...draft, total: "10.00" },
      { ...draft, lines: [{ ...line, unitPrice: "8.75" }] },
      { ...draft, payments: [{ paymentMethod: "01", amount: "1.00", term: 30 }] },
    ]) {
      expect(messages(createDraftSchema.safeParse(body))).toContain(
        "La solicitud contiene campos no permitidos.",
      );
    }
  });

  it("cantidad, descuento e importe son decimales exactos en texto, sin redondear", () => {
    const quantity = (value: unknown) =>
      createDraftSchema.safeParse({ lines: [{ productId: "p", quantity: value }] });
    expect(quantity("999999999999.999999").success).toBe(true);
    expect(quantity("123456789012.123456").data?.lines[0]?.quantity).toBe("123456789012.123456");
    expect(messages(quantity("1.1234567"))).toEqual(["Admite como máximo 6 decimales."]);
    expect(quantity(3).success).toBe(false);
    expect(quantity("1e3").success).toBe(false);
    expect(quantity("-1").success).toBe(false);
    const discount = (value: string) =>
      createDraftSchema.safeParse({ lines: [{ ...line, discount: value }] });
    expect(discount("1.25").success).toBe(true);
    expect(messages(discount("1.255"))).toEqual(["Admite como máximo 2 decimales."]);
    const amount = (value: string) =>
      createDraftSchema.safeParse({ payments: [{ paymentMethod: "01", amount: value }] });
    expect(amount("31.13").success).toBe(true);
    expect(amount("31.135").success).toBe(false);
  });

  it("la forma de pago es una entrada del catálogo por su clave", () => {
    expect(
      createDraftSchema.safeParse({ payments: [{ paymentMethod: "01" }, { paymentMethod: "19" }] })
        .success,
    ).toBe(true);
    expect(messages(createDraftSchema.safeParse({ payments: [{ paymentMethod: "a b" }] }))).toEqual(
      ["La forma de pago no es válida."],
    );
  });

  it("el máximo absoluto de líneas del contrato es el del rango de INVOICE_MAX_LINES", () => {
    const lines = (count: number) => Array.from({ length: count }, () => line);
    expect(createDraftSchema.safeParse({ lines: lines(INVOICE_LINES_MAX) }).success).toBe(true);
    expect(messages(createDraftSchema.safeParse({ lines: lines(INVOICE_LINES_MAX + 1) }))).toEqual([
      `El borrador admite como máximo ${INVOICE_LINES_MAX} líneas.`,
    ]);
  });

  it("corregir exige la versión esperada", () => {
    expect(updateDraftSchema.safeParse({ ...draft, expectedVersion: 2 }).success).toBe(true);
    expect(messages(updateDraftSchema.safeParse(draft))).toEqual([
      "La versión esperada es obligatoria.",
    ]);
  });
});

describe("contrato de la emisión", () => {
  it("emitir lleva el borrador y su versión, y nada más", () => {
    expect(emitInvoiceSchema.parse({ draftId: "d-1", expectedVersion: 3 })).toEqual({
      draftId: "d-1",
      expectedVersion: 3,
    });
    expect(
      messages(emitInvoiceSchema.safeParse({ draftId: "d-1", expectedVersion: 3, companyId: "x" })),
    ).toContain("La solicitud contiene campos no permitidos.");
    expect(emitInvoiceSchema.safeParse({ draftId: "d-1" }).success).toBe(false);
  });

  it("Idempotency-Key: de 1 a 100 caracteres ASCII visibles", () => {
    const header = (value: unknown) =>
      emitInvoiceHeadersSchema.safeParse({ "Idempotency-Key": value });
    expect(header("a").success).toBe(true);
    expect(header("x".repeat(100)).success).toBe(true);
    expect(header("f47ac10b-58cc-4372-a567-0e02b2c3d479").success).toBe(true);
    for (const invalid of ["", "x".repeat(101), "con espacio", "ñ", undefined]) {
      expect(header(invalid).success, String(invalid)).toBe(false);
    }
  });

  it("la consulta de facturas ignora companyId y filtra por estado", () => {
    expect(listInvoicesQuerySchema.parse({ companyId: "x", state: "RESERVED" })).toEqual({
      state: "RESERVED",
      page: 1,
      pageSize: 25,
    });
    expect(listInvoicesQuerySchema.safeParse({ state: "DRAFT" }).success).toBe(false);
  });

  it("cada código del diagnóstico tiene una de las tres clases", () => {
    expect(new Set(Object.values(SIGNING_ATTEMPT_CODES))).toEqual(
      new Set(["RETRYABLE_OPERATIONAL", "DETERMINISTIC_CONFIGURATION", "DETERMINISTIC_VALIDATION"]),
    );
  });

  it("las rutas de design D13 y de la transmisión (add-sri-transmission, D18) están registradas", () => {
    const invoiceRoutes = apiRoutes
      .filter((route) => route.path.startsWith("/invoices"))
      .map((route) => `${route.method.toUpperCase()} ${route.path}`);
    expect(invoiceRoutes).toEqual([
      "GET /invoices/drafts",
      "POST /invoices/drafts",
      "POST /invoices/drafts/preview",
      "GET /invoices/drafts/:draftId",
      "PUT /invoices/drafts/:draftId",
      "DELETE /invoices/drafts/:draftId",
      "POST /invoices",
      "GET /invoices",
      "GET /invoices/:invoiceId",
      "GET /invoices/:invoiceId/transmission",
      "POST /invoices/:invoiceId/reconciliations",
      "POST /invoices/:invoiceId/signing-attempts",
      "GET /invoices/entries",
    ]);
  });
});

describe("contrato de la transmisión (add-sri-transmission, tarea 4.1, design D18)", () => {
  it("los estados de la transmisión llevan las etiquetas del glosario", () => {
    expect(INVOICE_STATES).toEqual([
      "RESERVED",
      "SIGNED",
      "SEND_UNKNOWN",
      "RECEIVED",
      "RETURNED",
      "AUTHORIZED",
      "NOT_AUTHORIZED",
      "MANUAL_REVIEW",
    ]);
    expect(INVOICE_STATE_LABELS).toEqual({
      RESERVED: "Procesando",
      SIGNED: "Pendiente de envío",
      SEND_UNKNOWN: "Verificando con el SRI",
      RECEIVED: "Pendiente de autorización",
      RETURNED: "Devuelto",
      AUTHORIZED: "Autorizado",
      NOT_AUTHORIZED: "No autorizado",
      MANUAL_REVIEW: "Requiere revisión",
    });
    expect(RECONCILABLE_STATES).toEqual(["SIGNED", "SEND_UNKNOWN", "RECEIVED", "MANUAL_REVIEW"]);
  });

  it('el listado filtra por un estado de la transmisión y por "requiere atención"', () => {
    expect(
      listInvoicesQuerySchema.parse({ state: "MANUAL_REVIEW", attention: "true" }),
    ).toMatchObject({ state: "MANUAL_REVIEW", attention: "true", page: 1 });
    expect(listInvoicesQuerySchema.safeParse({ attention: "false" }).success).toBe(false);
    expect(listInvoicesQuerySchema.safeParse({ state: "SEND_PENDING" }).success).toBe(false);
  });

  it("la reconciliación exige un motivo de 1 a 500 caracteres y ningún otro campo", () => {
    expect(requestReconciliationSchema.parse({ reason: "  El SRI ya respondió.  " })).toEqual({
      reason: "El SRI ya respondió.",
    });
    expect(messages(requestReconciliationSchema.safeParse({}))).toEqual([
      "Indica el motivo de la reconciliación.",
    ]);
    expect(messages(requestReconciliationSchema.safeParse({ reason: "   " }))).toEqual([
      "Indica el motivo de la reconciliación.",
    ]);
    expect(requestReconciliationSchema.safeParse({ reason: "x".repeat(500) }).success).toBe(true);
    expect(messages(requestReconciliationSchema.safeParse({ reason: "x".repeat(501) }))).toEqual([
      "El motivo admite como máximo 500 caracteres.",
    ]);
    expect(requestReconciliationSchema.safeParse({ reason: "x", force: true }).success).toBe(false);
  });

  it("los códigos de la reconciliación son estables", () => {
    expect(INVOICE_ERROR_CODES).toEqual(
      expect.arrayContaining(["SRI_INTERACTION_IN_PROGRESS", "INVOICE_NOT_RECONCILABLE"]),
    );
  });

  it("el resumen y el historial no admiten respuestas originales ni XML", () => {
    const summary = {
      inProgress: false,
      stopped: null,
      reconcilable: false,
      authorization: {
        number: "1".repeat(49),
        authorizedAt: "2026-10-04T15:00:00.000Z",
        environment: "TEST",
      },
      lastResult: {
        operation: "AUTHORIZATION",
        outcome: "AUTHORIZED",
        at: "2026-10-04T15:00:01.000Z",
        messages: [
          {
            identifier: "60",
            message: "AMBIENTE",
            additionalInformation: null,
            type: "ADVERTENCIA",
          },
        ],
      },
    };
    expect(invoiceTransmissionSummarySchema.parse(summary)).toEqual(summary);
    expect(
      invoiceTransmissionSummarySchema.safeParse({ ...summary, responseBody: "<soap/>" }).success,
    ).toBe(false);
    const view = {
      invoiceId: "inv-1",
      state: "AUTHORIZED",
      events: [
        {
          kind: "ATTEMPT",
          at: "2026-10-04T15:00:01.000Z",
          operation: "RECEPTION",
          origin: "AUTOMATIC",
          outcome: "RECEIVED",
          messages: [],
        },
        {
          kind: "TRANSITION",
          at: "2026-10-04T15:00:00.000Z",
          fromState: "SIGNED",
          toState: "RECEIVED",
          cause: "TRANSMISSION",
          actor: "SYSTEM",
          actorName: null,
        },
      ],
      total: 2,
    };
    expect(invoiceTransmissionViewSchema.parse(view)).toEqual(view);
    expect(
      invoiceTransmissionViewSchema.safeParse({
        ...view,
        events: [{ ...view.events[0], xml: "<factura/>" }],
      }).success,
    ).toBe(false);
  });
});

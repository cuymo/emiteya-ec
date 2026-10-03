// Contratos de borradores y facturas (add-invoice-emission, tarea 4.1, design D2, D8 y D13).
import { describe, expect, it } from "vitest";
import {
  INVOICE_LINES_MAX,
  SIGNING_ATTEMPT_CODES,
  apiRoutes,
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

  it("las rutas de design D13 están registradas", () => {
    const invoiceRoutes = apiRoutes
      .filter((route) => route.path.startsWith("/invoices"))
      .map((route) => `${route.method.toUpperCase()} ${route.path}`);
    expect(invoiceRoutes).toEqual([
      "GET /invoices/drafts",
      "POST /invoices/drafts",
      "GET /invoices/drafts/:draftId",
      "PUT /invoices/drafts/:draftId",
      "DELETE /invoices/drafts/:draftId",
      "POST /invoices",
      "GET /invoices",
      "GET /invoices/:invoiceId",
      "POST /invoices/:invoiceId/signing-attempts",
    ]);
  });
});

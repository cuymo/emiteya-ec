// Contratos de las liquidaciones de compra (add-purchase-settlements, tarea 3.1, design D3, D6, D9,
// D21 y D22): cuerpos estrictos, campos no permitidos (totales, impuestos distintos del IVA, reembolsos,
// subsidios, detalles adicionales, `companyId`, declaraciones desconocidas), longitudes medidas ya
// recortadas, decimales exactos y máximos absolutos como defensa de recursos.
import { describe, expect, it } from "vitest";
import {
  PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY,
  PURCHASE_SETTLEMENT_LIMITS_DEFAULT,
  PURCHASE_SETTLEMENT_LIMITS_MAX,
  PURCHASE_SETTLEMENT_STATEMENTS,
  PURCHASE_SETTLEMENT_STATEMENT_TEXTS,
  PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE,
  createPurchaseSettlementDraftSchema,
  emitPurchaseSettlementSchema,
  purchaseSettlementLineSchema,
  purchaseSettlementPaymentSchema,
  purchaseSettlementQuantitySchema,
  updatePurchaseSettlementDraftSchema,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

const line = {
  productId: null,
  description: "Saco de cacao en grano, 45 kg",
  unit: "saco",
  quantity: "10",
  unitPrice: "4.5",
  discount: "5.00",
  ivaRate: "IVA-15",
};
const payment = { paymentMethod: "01", total: "50.00", term: "0", timeUnit: "días" };
const draft = {
  emissionPointId: "pto-1",
  supplierPartyId: "party-1",
  supplierAddress: "Comunidad San Pablo, Cayambe",
  lines: [line],
  payments: [payment],
};

describe("borrador de la liquidación", () => {
  it("acepta un borrador completo y uno vacío", () => {
    expect(createPurchaseSettlementDraftSchema.safeParse(draft).success).toBe(true);
    expect(createPurchaseSettlementDraftSchema.parse({})).toEqual({
      emissionPointId: null,
      supplierPartyId: null,
      supplierAddress: null,
      lines: [],
      payments: [],
    });
    expect(
      updatePurchaseSettlementDraftSchema.safeParse({ ...draft, expectedVersion: 2 }).success,
    ).toBe(true);
  });

  it("rechaza un companyId, un total, un impuesto distinto del IVA, un reembolso o información adicional", () => {
    for (const body of [
      { ...draft, companyId: "otra" },
      { ...draft, importeTotal: "106.00" },
      { ...draft, totals: { total: "106.00" } },
      { ...draft, reembolsos: [] },
      { ...draft, infoAdicional: [{ nombre: "x", valor: "y" }] },
      { ...draft, currency: "EURO" },
      { ...draft, supplier: { identification: "0102030405" } },
    ]) {
      expect(
        createPurchaseSettlementDraftSchema.safeParse(body).success,
        JSON.stringify(body),
      ).toBe(false);
    }
  });

  it("una línea no admite subsidios, detalles adicionales, otro impuesto ni importes calculados", () => {
    for (const extra of [
      { precioSinSubsidio: "1.00" },
      { detallesAdicionales: [{ nombre: "Serie", valor: "X" }] },
      { ice: "3051" },
      { taxes: [{ code: "3" }] },
      { taxableBase: "40.00" },
      { taxAmount: "6.00" },
    ]) {
      expect(purchaseSettlementLineSchema.safeParse({ ...line, ...extra }).success).toBe(false);
    }
  });

  it("mide los textos ya recortados, rechaza saltos de línea y guarda un texto vacío como ausente", () => {
    const parsed = purchaseSettlementLineSchema.parse({
      ...line,
      mainCode: "  CAC-01  ",
      auxiliaryCode: "   ",
      description: ` ${"é".repeat(300)} `,
    });
    expect(parsed.mainCode).toBe("CAC-01");
    expect(parsed.auxiliaryCode).toBeNull();
    expect(parsed.description).toHaveLength(300);
    expect(
      messages(purchaseSettlementLineSchema.safeParse({ ...line, description: "x".repeat(301) })),
    ).toContain("La descripción admite como máximo 300 caracteres.");
    expect(
      messages(purchaseSettlementLineSchema.safeParse({ ...line, description: "Cacao\nfino" })),
    ).toContain("La descripción no admite saltos de línea.");
    expect(
      messages(purchaseSettlementLineSchema.safeParse({ ...line, mainCode: "C".repeat(26) })),
    ).toContain("El código principal admite como máximo 25 caracteres.");
    expect(
      messages(purchaseSettlementLineSchema.safeParse({ ...line, unit: "u".repeat(51) })),
    ).toContain("La unidad de medida admite como máximo 50 caracteres.");
    const address = createPurchaseSettlementDraftSchema.safeParse({
      ...draft,
      supplierAddress: `  ${"a".repeat(301)}`,
    });
    expect(messages(address)).toContain(
      "La dirección del proveedor admite como máximo 300 caracteres.",
    );
    expect(
      createPurchaseSettlementDraftSchema.parse({
        ...draft,
        supplierAddress: `  ${"a".repeat(300)}  `,
      }).supplierAddress,
    ).toHaveLength(300);
  });

  it("cantidades y precios exactos de hasta 6 decimales, descuento de 2 y siempre presente", () => {
    expect(purchaseSettlementLineSchema.parse({ ...line, discount: undefined }).discount).toBe("0");
    expect(purchaseSettlementLineSchema.parse({ ...line, discount: null }).discount).toBe("0");
    expect(
      purchaseSettlementLineSchema.safeParse({
        ...line,
        quantity: "1.333333",
        unitPrice: "3.000003",
      }).success,
    ).toBe(true);
    for (const values of [
      { quantity: "1.1234567" },
      { unitPrice: "0.0000001" },
      { discount: "1.001" },
      { quantity: 10 },
      { unitPrice: "-1" },
      { quantity: "1e3" },
    ]) {
      expect(
        purchaseSettlementLineSchema.safeParse({ ...line, ...values }).success,
        JSON.stringify(values),
      ).toBe(false);
    }
    // En el borrador basta el formato; la emisión exige una cantidad mayor que cero.
    expect(purchaseSettlementLineSchema.safeParse({ ...line, quantity: "0" }).success).toBe(true);
    expect(purchaseSettlementQuantitySchema.safeParse("0").success).toBe(false);
    expect(purchaseSettlementQuantitySchema.safeParse("0.000001").success).toBe(true);
  });

  it("un pago lleva su forma de pago, su total, su plazo y su unidad de tiempo, sin valores por defecto", () => {
    expect(purchaseSettlementPaymentSchema.parse({})).toEqual({
      paymentMethod: null,
      total: null,
      term: null,
      timeUnit: null,
    });
    expect(
      purchaseSettlementPaymentSchema.safeParse({ ...payment, total: "0.00", term: "0" }).success,
    ).toBe(true);
    expect(
      purchaseSettlementPaymentSchema.safeParse({ ...payment, term: "99999999999999" }).success,
    ).toBe(true);
    for (const values of [
      { term: "1.234" },
      { term: "-1" },
      { term: "100000000000000" },
      { total: "-0.01" },
      { timeUnit: "quincenales" },
      { timeUnit: "días\n" + "x" },
      { paymentMethod: "efectivo" },
      { plazo: "30" },
    ]) {
      expect(
        purchaseSettlementPaymentSchema.safeParse({ ...payment, ...values }).success,
        JSON.stringify(values),
      ).toBe(false);
    }
  });

  it("los máximos absolutos son defensas del sistema, no límites del SRI", () => {
    expect(PURCHASE_SETTLEMENT_LIMITS_DEFAULT).toEqual({ lines: 100, payments: 10 });
    expect(PURCHASE_SETTLEMENT_LIMITS_MAX).toEqual({ lines: 500, payments: 20 });
    const lines = createPurchaseSettlementDraftSchema.safeParse({
      ...draft,
      lines: Array.from({ length: 501 }, () => line),
    });
    expect(messages(lines).join(" ")).toMatch(/500 líneas\. Es una defensa de recursos/);
    const payments = createPurchaseSettlementDraftSchema.safeParse({
      ...draft,
      payments: Array.from({ length: 21 }, () => payment),
    });
    expect(messages(payments).join(" ")).toMatch(/20 pagos\. Es una defensa de recursos/);
    expect(
      createPurchaseSettlementDraftSchema.safeParse({
        ...draft,
        lines: Array.from({ length: 500 }, () => line),
        payments: Array.from({ length: 20 }, () => payment),
      }).success,
    ).toBe(true);
  });
});

describe("emisión de la liquidación", () => {
  const declarations = {
    policyVersion: 1,
    statements: [...PURCHASE_SETTLEMENT_STATEMENTS],
  };

  it("acepta las cuatro declaraciones con la versión de la política", () => {
    expect(
      emitPurchaseSettlementSchema.safeParse({ draftId: "d-1", expectedVersion: 3, declarations })
        .success,
    ).toBe(true);
  });

  it("rechaza una declaración desconocida, una casilla genérica, un companyId y declaraciones ausentes", () => {
    for (const body of [
      {
        draftId: "d-1",
        expectedVersion: 1,
        declarations: { ...declarations, statements: ["PROVIDER_IS_RUSTIC"] },
      },
      { draftId: "d-1", expectedVersion: 1, declarations: { policyVersion: 1, accepted: true } },
      { draftId: "d-1", expectedVersion: 1, declarations, companyId: "otra" },
      { draftId: "d-1", expectedVersion: 1 },
      { draftId: "d-1", expectedVersion: 1, declarations: { ...declarations, verified: true } },
    ]) {
      expect(emitPurchaseSettlementSchema.safeParse(body).success, JSON.stringify(body)).toBe(
        false,
      );
    }
  });

  it("la política es el caso c) del art. 13, con cuatro declaraciones de texto propio, y el aviso es fijo", () => {
    expect(PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY).toMatchObject({
      id: "PURCHASE_SETTLEMENT_ELIGIBILITY_V1",
      rule: "ART_13_C_RUSTICITY_NO_ACTIVE_RUC",
      case: "ART_13_C",
      version: 1,
    });
    expect(Object.keys(PURCHASE_SETTLEMENT_STATEMENT_TEXTS)).toEqual([
      ...PURCHASE_SETTLEMENT_STATEMENTS,
    ]);
    expect(PURCHASE_SETTLEMENT_WITHHOLDING_NOTICE).toBe(
      "Esta operación requiere la retención correspondiente conforme a la normativa aplicable.",
    );
  });
});

// Evaluación de la liquidación de compra (add-purchase-settlements, tarea 4.1, design D4 a D9, D12 y
// D22): cada regla en el orden de D12, con el campo y la posición de la línea o del pago en cada
// problema. La vista previa muestra todos; la emisión rechaza con el primero.
import { describe, expect, it } from "vitest";
import { evaluatePurchaseSettlement } from "../../src/modules/purchase-settlements/domain/evaluation.ts";
import { CATALOGS, IVA, PRODUCT, SUPPLIER, evaluationInput, line, payment } from "./fixtures.ts";

const codes = (input: Parameters<typeof evaluatePurchaseSettlement>[0]) =>
  evaluatePurchaseSettlement(input).issues.map((issue) => issue.code);

describe("evaluación de la liquidación de compra", () => {
  it("una liquidación válida no tiene problemas y lleva los importes del spec", () => {
    const evaluation = evaluatePurchaseSettlement(evaluationInput());
    expect(evaluation.issues).toEqual([]);
    expect(evaluation.amounts?.totals.total).toBe("106.00");
    expect(evaluation.paymentsTotal).toBe("106.00");
    expect(evaluation.lines.map((resolved) => resolved.iva.entry.code)).toEqual(["4", "0"]);
    expect(evaluation.payments.map((paid) => [paid.entry.code, paid.total, paid.term])).toEqual([
      ["01", "50.00", "0"],
      ["20", "56.00", "30"],
    ]);
  });

  it("los problemas de la preparación van primero", () => {
    const readiness = {
      code: "TAXPAYER_NOT_CONFIGURED" as const,
      message: "Registra los datos tributarios de la empresa antes de emitir.",
      field: null,
      line: null,
      payment: null,
    };
    expect(codes(evaluationInput({ readiness: [readiness] }))[0]).toBe("TAXPAYER_NOT_CONFIGURED");
  });

  describe("proveedor (design D4)", () => {
    it("sin proveedor o de otra empresa", () => {
      expect(codes(evaluationInput({ draft: { supplierPartyId: null }, supplier: null }))).toEqual([
        "PURCHASE_SETTLEMENT_SUPPLIER_REQUIRED",
      ]);
      expect(codes(evaluationInput({ supplier: null }))).toEqual([
        "PURCHASE_SETTLEMENT_SUPPLIER_NOT_FOUND",
      ]);
    });

    it("inactivo, consumidor final, con RUC, del exterior o sin el rol de proveedor", () => {
      const cases = [
        [{ status: "INACTIVE" }, "PURCHASE_SETTLEMENT_SUPPLIER_INACTIVE"],
        [
          { consumerFinal: true, identificationType: "07", identification: "9999999999999" },
          "PURCHASE_SETTLEMENT_SUPPLIER_CONSUMER_FINAL",
        ],
        [
          { identificationType: "04", identification: "1790012345001" },
          "PURCHASE_SETTLEMENT_SUPPLIER_IDENTIFICATION_NOT_ALLOWED",
        ],
        [
          { identificationType: "08", identification: "X123" },
          "PURCHASE_SETTLEMENT_SUPPLIER_IDENTIFICATION_NOT_ALLOWED",
        ],
        [{ roles: ["CUSTOMER"] }, "PURCHASE_SETTLEMENT_SUPPLIER_ROLE_REQUIRED"],
      ] as const;
      for (const [values, code] of cases) {
        const evaluation = evaluatePurchaseSettlement(
          evaluationInput({ supplier: { ...SUPPLIER, ...values } }),
        );
        expect(
          evaluation.issues.map((issue) => issue.code),
          code,
        ).toEqual([code]);
        expect(evaluation.issues[0]!.field).toBe("supplierPartyId");
        expect(evaluation.supplier).toBeNull();
      }
    });

    it("el RUC se rechaza como restricción del sistema para el caso c), y el rol no se asigna", () => {
      const ruc = evaluatePurchaseSettlement(
        evaluationInput({ supplier: { ...SUPPLIER, identificationType: "04" } }),
      );
      expect(ruc.issues[0]!.message).toMatch(/caso c\)/);
      expect(ruc.issues[0]!.message).toMatch(/no una regla para toda liquidación/);
      const role = evaluatePurchaseSettlement(
        evaluationInput({ supplier: { ...SUPPLIER, roles: [] } }),
      );
      expect(role.issues[0]!.message).toMatch(/márcalo como proveedor en Terceros/);
    });

    it("pasaporte es válido", () => {
      expect(
        codes(
          evaluationInput({
            supplier: { ...SUPPLIER, identificationType: "06", identification: "AB123456" },
          }),
        ),
      ).toEqual([]);
    });
  });

  it("la dirección del proveedor es obligatoria y escribible (design D5)", () => {
    const missing = evaluatePurchaseSettlement(
      evaluationInput({ draft: { supplierAddress: null } }),
    );
    expect(missing.issues.map((issue) => [issue.code, issue.field])).toEqual([
      ["PURCHASE_SETTLEMENT_ADDRESS_REQUIRED", "supplierAddress"],
    ]);
    expect(codes(evaluationInput({ draft: { supplierAddress: "Cayambe\u0001" } }))).toEqual([
      "PURCHASE_SETTLEMENT_ADDRESS_REQUIRED",
    ]);
  });

  it("los límites efectivos de líneas y pagos son una defensa del sistema (design D22)", () => {
    const evaluation = evaluatePurchaseSettlement(
      evaluationInput({ limits: { lines: 1, payments: 1 } }),
    );
    expect(evaluation.issues.map((issue) => [issue.code, issue.field])).toEqual([
      ["PURCHASE_SETTLEMENT_RESOURCE_LIMIT", "lines"],
      ["PURCHASE_SETTLEMENT_RESOURCE_LIMIT", "payments"],
    ]);
    expect(evaluation.issues[0]!.message).toMatch(
      /defensa de recursos del sistema, no un límite del SRI/,
    );
  });

  it("sin líneas ni pagos", () => {
    expect(codes(evaluationInput({ draft: { lines: [], payments: [] } }))).toEqual([
      "PURCHASE_SETTLEMENT_LINES_REQUIRED",
      "PURCHASE_SETTLEMENT_PAYMENTS_REQUIRED",
    ]);
  });

  describe("líneas (design D6 y D7)", () => {
    // La línea por defecto suma 46.00: 10 × 4.50 − 5.00 y el 15 % de 40.00.
    const withLine = (values: Parameters<typeof line>[0], total = "46.00") =>
      evaluatePurchaseSettlement(
        evaluationInput({ draft: { lines: [line(values)], payments: [payment({ total })] } }),
      );

    it("producto opcional: inexistente o inactivo, junto a su línea; uno activo no impone su precio", () => {
      expect(
        withLine({ productId: "otro" }).issues.map((issue) => [issue.code, issue.line]),
      ).toEqual([["PURCHASE_SETTLEMENT_PRODUCT_NOT_FOUND", 1]]);
      const inactive = evaluatePurchaseSettlement(
        evaluationInput({
          products: new Map([[PRODUCT.id, { ...PRODUCT, status: "INACTIVE" }]]),
          draft: {
            lines: [line({ productId: PRODUCT.id })],
            payments: [payment({ total: "46.00" })],
          },
        }),
      );
      expect(inactive.issues.map((issue) => issue.code)).toEqual([
        "PURCHASE_SETTLEMENT_PRODUCT_INACTIVE",
      ]);
      const priced = withLine({ productId: PRODUCT.id, unitPrice: "4.5", mainCode: "CAC-01" });
      expect(priced.issues).toEqual([]);
      expect(priced.lines[0]).toMatchObject({ productId: PRODUCT.id, unitPrice: "4.5" });
    });

    it("descripción, cantidad, precio y textos escribibles", () => {
      const at = (values: Parameters<typeof line>[0]) =>
        withLine(values).issues.map((issue) => [issue.code, issue.field, issue.line]);
      expect(at({ description: null })).toEqual([
        ["PURCHASE_SETTLEMENT_DESCRIPTION_INVALID", "description", 1],
      ]);
      expect(at({ description: "Cacao\u0000" })).toEqual([
        ["PURCHASE_SETTLEMENT_DESCRIPTION_INVALID", "description", 1],
      ]);
      expect(at({ mainCode: "C\u0007" })).toEqual([
        ["PURCHASE_SETTLEMENT_CODE_INVALID", "mainCode", 1],
      ]);
      expect(at({ quantity: "0" })).toEqual([
        ["PURCHASE_SETTLEMENT_QUANTITY_INVALID", "quantity", 1],
      ]);
      expect(at({ quantity: null })).toEqual([
        ["PURCHASE_SETTLEMENT_QUANTITY_INVALID", "quantity", 1],
      ]);
      expect(at({ unitPrice: null })).toEqual([
        ["PURCHASE_SETTLEMENT_PRICE_INVALID", "unitPrice", 1],
      ]);
    });

    it("descuento mayor que el subtotal, junto a su línea", () => {
      expect(
        withLine({ discount: "45.01" }).issues.map((issue) => [issue.code, issue.line]),
      ).toEqual([["PURCHASE_SETTLEMENT_DISCOUNT_EXCEEDS_SUBTOTAL", 1]]);
    });

    it("IVA: obligatorio, vigente y habilitado en la fecha de emisión, y con porcentaje de cálculo", () => {
      expect(withLine({ ivaRate: null }).issues.map((issue) => issue.code)).toEqual([
        "PURCHASE_SETTLEMENT_IVA_RATE_REQUIRED",
      ]);
      expect(withLine({ ivaRate: "99" }).issues.map((issue) => issue.code)).toEqual([
        "PURCHASE_SETTLEMENT_IVA_RATE_NOT_EFFECTIVE",
      ]);
      const disabled = evaluatePurchaseSettlement(
        evaluationInput({
          catalogs: {
            ...CATALOGS,
            ivaRates: new Map([["4", { entryKey: "4", applicable: IVA["15"], usable: false }]]),
          },
          draft: { lines: [line()], payments: [payment({ total: "46.00" })] },
        }),
      );
      expect(disabled.issues.map((issue) => issue.code)).toEqual([
        "PURCHASE_SETTLEMENT_IVA_RATE_NOT_EFFECTIVE",
      ]);
      expect(withLine({ ivaRate: "8" }).issues[0]!.message).toMatch(
        /no tiene un porcentaje de cálculo/,
      );
      // No objeto y exento calculan con 0.
      for (const ivaRate of ["6", "7"]) {
        const exempt = withLine({ ivaRate, discount: "0" }, "45.00");
        expect(exempt.issues).toEqual([]);
        expect(exempt.amounts?.totals.taxes[0]).toMatchObject({
          rateCode: ivaRate,
          amount: "0.00",
        });
      }
    });

    it("la cantidad y el precio se guardan en forma canónica, sin redondeo", () => {
      const evaluation = withLine({ quantity: "10.000000", unitPrice: "4.500000" });
      expect(evaluation.lines[0]).toMatchObject({ quantity: "10", unitPrice: "4.5" });
    });

    it("la vista previa calcula las líneas válidas aunque otra falle", () => {
      const evaluation = evaluatePurchaseSettlement(
        evaluationInput({ draft: { lines: [line(), line({ unitPrice: null })] } }),
      );
      expect(evaluation.computed.map((amount) => amount.position)).toEqual([1]);
      expect(evaluation.amounts).toBeNull();
    });
  });

  describe("pagos (design D9)", () => {
    const at = (payments: Parameters<typeof payment>[0][]) =>
      evaluatePurchaseSettlement(
        evaluationInput({ draft: { payments: payments.map(payment) } }),
      ).issues.map((issue) => [issue.code, issue.field, issue.payment]);

    it("forma de pago del catálogo, total, plazo y unidad de tiempo escritos", () => {
      expect(at([{ paymentMethod: null }])).toEqual([
        ["PURCHASE_SETTLEMENT_PAYMENT_METHOD_INVALID", "paymentMethod", 1],
      ]);
      expect(at([{ paymentMethod: "99" }])).toEqual([
        ["PURCHASE_SETTLEMENT_PAYMENT_METHOD_INVALID", "paymentMethod", 1],
      ]);
      expect(at([{ total: null }])).toEqual([
        ["PURCHASE_SETTLEMENT_PAYMENT_TOTAL_REQUIRED", "total", 1],
      ]);
      expect(at([{ term: null }])).toEqual([
        ["PURCHASE_SETTLEMENT_PAYMENT_TERM_REQUIRED", "term", 1],
      ]);
      expect(at([{ timeUnit: null }])).toEqual([
        ["PURCHASE_SETTLEMENT_PAYMENT_TERM_REQUIRED", "timeUnit", 1],
      ]);
    });

    it("la suma de los pagos es exactamente el importe total, sin tolerancia", () => {
      const short = evaluatePurchaseSettlement(
        evaluationInput({
          draft: { payments: [payment({ total: "50.00" }), payment({ total: "55.99" })] },
        }),
      );
      expect(short.issues.map((issue) => [issue.code, issue.field])).toEqual([
        ["PURCHASE_SETTLEMENT_PAYMENTS_MISMATCH", "payments"],
      ]);
      expect(short.issues[0]!.message).toBe(
        "Los pagos suman USD 105.99 y el importe total es USD 106.00: faltan USD 0.01.",
      );
      const over = evaluatePurchaseSettlement(
        evaluationInput({ draft: { payments: [payment({ total: "106.01" })] } }),
      );
      expect(over.issues[0]!.message).toMatch(/sobran USD 0.01/);
      // Un pago de 0.00 es válido si la suma coincide (dominio del XSD).
      expect(
        codes(
          evaluationInput({
            draft: { payments: [payment({ total: "106.00" }), payment({ total: "0.00" })] },
          }),
        ),
      ).toEqual([]);
    });

    it("un pago que no cabe en el XSD se informa junto a su pago, sin romper la evaluación", () => {
      const evaluation = evaluatePurchaseSettlement(
        evaluationInput({ draft: { payments: [payment({ total: "99999999999999" })] } }),
      );
      expect(evaluation.issues.map((issue) => [issue.code, issue.payment])).toEqual([
        ["PURCHASE_SETTLEMENT_AMOUNT_OUT_OF_RANGE", 1],
        ["PURCHASE_SETTLEMENT_PAYMENTS_MISMATCH", null],
      ]);
      expect(evaluation.paymentsTotal).toBeNull();
    });
  });
});

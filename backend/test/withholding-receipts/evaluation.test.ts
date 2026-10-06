// Evaluación del comprobante de retención (add-withholding-receipts, tarea 4.2, design D3 a D6, D8,
// D9, D12, D15 y D25): cada rechazo con su código y la posición del documento y de la retención, el
// aviso del período, los importes declarados sin comparaciones ni recálculos, y ninguna retención
// que el usuario no eligió. Los catálogos salen de los datasets instalados.
import { describe, expect, it } from "vitest";
import { evaluateWithholdingReceipt } from "../../src/modules/withholding-receipts/domain/evaluation.ts";
import {
  DRAFT,
  ISSUE_DATE,
  SUPPLIER,
  SUPPORT,
  catalogsFor,
  evaluationInput,
  withSupport,
} from "./fixtures.ts";

type Input = Parameters<typeof evaluationInput>[0];
const evaluate = (overrides: Input = {}) => evaluateWithholdingReceipt(evaluationInput(overrides));
const codes = (overrides: Input = {}) =>
  evaluate(overrides).issues.map(({ code, support, tax, payment, withholding }) => ({
    code,
    support,
    tax,
    payment,
    withholding,
  }));
const at = (
  code: string,
  position: { support?: number; tax?: number; payment?: number; withholding?: number } = {},
) => ({
  code,
  support: position.support ?? null,
  tax: position.tax ?? null,
  payment: position.payment ?? null,
  withholding: position.withholding ?? null,
});
const item = (tax: string | null, entryKey: string | null, base: string | null = "100.00") => ({
  tax,
  entryKey,
  base,
});

describe("un comprobante válido", () => {
  it("no tiene problemas, resuelve sus documentos y calcula cada retención con el catálogo", () => {
    const result = evaluate();
    expect(result.issues).toEqual([]);
    expect(result.periodDiffersFromIssueMonth).toBe(false);
    expect(result.issueMonth).toBe("10/2026");
    expect(result.amounts?.withheld).toBe("6.27");
    expect(result.computed.map((c) => [c.item.entry.code, c.base, c.percentage, c.amount])).toEqual(
      [
        ["312C", "100.29", "1.75", "1.76"],
        ["1", "15.04", "30", "4.51"],
      ],
    );
    const [support] = result.supports;
    expect(support).toMatchObject({
      position: 1,
      documentType: { code: "01", officialLabel: "Factura" },
      supportCode: { code: "01" },
      number: "001001000000123",
      issueDate: "2026-10-01",
    });
    expect(support?.taxes).toEqual([
      expect.objectContaining({
        tax: "2",
        tariff: "15",
        tariffBasis: "CATALOG",
        base: "100.29",
        amount: "15.04",
      }),
    ]);
    expect(support?.payments.map((p) => [p.entry.code, p.total])).toEqual([["20", "115.33"]]);
  });

  it("varios documentos con varias retenciones conservan sus posiciones", () => {
    const second = {
      ...SUPPORT,
      documentType: "03",
      supportCode: "02",
      number: "001002000000045",
      withholdings: [
        item("1", "303", "500.00"),
        item("2", "3", "60.00"),
        item("1", "343", "10.00"),
      ],
    };
    const result = evaluate({ draft: { supports: [SUPPORT, second] } });
    expect(result.issues).toEqual([]);
    expect(result.computed.map((c) => [c.support, c.position, c.amount])).toEqual([
      [1, 1, "1.76"],
      [1, 2, "4.51"],
      [2, 1, "50.00"],
      [2, 2, "60.00"],
      [2, 3, "0.10"],
    ]);
    expect(result.amounts?.withheld).toBe("116.37");
  });

  it("solo calcula las retenciones que el usuario eligió: nunca agrega el código 7 ni el 8", () => {
    const result = evaluate({ draft: withSupport({ withholdings: [item("1", "303", "100.00")] }) });
    expect(result.issues).toEqual([]);
    expect(result.computed.map((c) => [c.item.tax, c.item.entry.code])).toEqual([["1", "303"]]);
    const zero = evaluate({ draft: withSupport({ withholdings: [item("2", "7", "15.00")] }) });
    expect(zero.issues).toEqual([]);
    expect(zero.computed.map((c) => [c.item.entry.code, c.percentage, c.amount])).toEqual([
      ["7", "0", "0.00"],
    ]);
    expect(zero.amounts?.withheld).toBe("0.00");
  });
});

describe("sujeto retenido y parte relacionada (design D3 y D4)", () => {
  it("sin proveedor, el borrador está incompleto; uno inexistente se informa", () => {
    expect(codes({ draft: { partyId: null } })).toEqual([at("WITHHOLDING_DRAFT_INCOMPLETE")]);
    expect(codes({ subject: null })).toEqual([at("WITHHOLDING_SUBJECT_NOT_FOUND")]);
  });

  it("rechaza al proveedor inactivo, al consumidor final citando la ficha, al del exterior y al que no es proveedor", () => {
    expect(codes({ subject: { ...SUPPLIER, status: "INACTIVE" } })).toEqual([
      at("WITHHOLDING_SUBJECT_INACTIVE"),
    ]);
    const consumer = evaluate({
      subject: {
        ...SUPPLIER,
        identificationType: "07",
        identification: "9999999999999",
        consumerFinal: true,
      },
    });
    expect(consumer.issues.map((i) => i.code)).toEqual(["WITHHOLDING_SUBJECT_CONSUMER_FINAL"]);
    expect(consumer.issues[0]?.message).toContain(
      "Ficha técnica de comprobantes electrónicos v2.34, página 13",
    );
    expect(codes({ subject: { ...SUPPLIER, identificationType: "08" } })).toEqual([
      at("WITHHOLDING_SUBJECT_FOREIGN_OUT_OF_SCOPE"),
    ]);
    expect(codes({ subject: { ...SUPPLIER, roles: ["CUSTOMER"] } })).toEqual([
      at("WITHHOLDING_SUBJECT_NOT_SUPPLIER"),
    ]);
    for (const identificationType of ["05", "06"]) {
      expect(codes({ subject: { ...SUPPLIER, identificationType } })).toEqual([]);
    }
  });

  it("exige la declaración de parte relacionada, sin valor por defecto", () => {
    expect(codes({ draft: { relatedParty: null } })).toEqual([
      at("WITHHOLDING_RELATED_PARTY_REQUIRED"),
    ]);
    expect(codes({ draft: { relatedParty: "SI" } })).toEqual([]);
  });
});

describe("período fiscal (design D5)", () => {
  it("rechaza un período futuro, uno inválido y la falta de período", () => {
    expect(codes({ draft: { fiscalPeriod: "11/2026" } })).toEqual([
      at("WITHHOLDING_FISCAL_PERIOD_IN_FUTURE"),
    ]);
    expect(codes({ draft: { fiscalPeriod: "01/2027" } })).toEqual([
      at("WITHHOLDING_FISCAL_PERIOD_IN_FUTURE"),
    ]);
    expect(codes({ draft: { fiscalPeriod: "2026-10" } })).toEqual([
      at("WITHHOLDING_FISCAL_PERIOD_INVALID"),
    ]);
    expect(codes({ draft: { fiscalPeriod: null } })).toEqual([at("WITHHOLDING_DRAFT_INCOMPLETE")]);
  });

  it("un período anterior al mes de emisión es válido y se avisa, sin corregirlo", () => {
    const result = evaluate({ draft: { fiscalPeriod: "09/2026" } });
    expect(result.issues).toEqual([]);
    expect(result.periodDiffersFromIssueMonth).toBe(true);
    expect(evaluate({ draft: { fiscalPeriod: "01/2020" } }).periodDiffersFromIssueMonth).toBe(true);
  });
});

describe("límites de recursos (design D25)", () => {
  it("aplica los límites efectivos como defensa del sistema, con la posición del documento", () => {
    const limits = { supports: 1, itemsPerSupport: 1, taxesPerSupport: 1, paymentsPerSupport: 1 };
    const result = evaluate({
      limits,
      draft: {
        supports: [
          {
            ...SUPPORT,
            taxes: [SUPPORT.taxes[0]!, SUPPORT.taxes[0]!],
            payments: [SUPPORT.payments[0]!, SUPPORT.payments[0]!],
          },
          SUPPORT,
        ],
      },
    });
    expect(
      result.issues.filter((i) => i.code === "WITHHOLDING_RESOURCE_LIMIT").map((i) => i.support),
    ).toEqual([null, 1, 1, 1, 2]);
    expect(result.issues[0]?.message).toContain("no un límite del SRI");
  });
});

describe("documentos sustento (design D6 y D10)", () => {
  it("exige al menos un documento", () => {
    expect(codes({ draft: { supports: [] } })).toEqual([at("WITHHOLDING_SUPPORTS_REQUIRED")]);
  });

  it("rechaza un tipo fuera del MVP y un sustento incompatible, vencido o fuera de alcance", () => {
    expect(codes({ draft: withSupport({ documentType: "04" }) })).toEqual([
      at("WITHHOLDING_SUPPORT_TYPE_NOT_SUPPORTED", { support: 1 }),
    ]);
    // La nota de venta no admite el sustento 01 (crédito tributario del IVA).
    expect(codes({ draft: withSupport({ documentType: "02", supportCode: "01" }) })).toEqual([
      at("WITHHOLDING_SUPPORT_CODE_INCOMPATIBLE", { support: 1 }),
    ]);
    // El rechazo indica los sustentos admitidos para la nota de venta y vigentes hoy.
    expect(
      evaluate({ draft: withSupport({ documentType: "02", supportCode: "01" }) }).issues[0]
        ?.message,
    ).toBe(
      "El código de sustento 01 no se puede usar con nota o boleta de venta. Sustentos admitidos: 02, 04, 05, 07, 14, 15.",
    );
    expect(codes({ draft: withSupport({ documentType: "02", supportCode: "02" }) })).toEqual([]);
    for (const supportCode of ["00", "08", "09", "10", "13"]) {
      expect(codes({ draft: withSupport({ supportCode }) }), supportCode).toEqual([
        at("WITHHOLDING_SUPPORT_CODE_INCOMPATIBLE", { support: 1 }),
      ]);
    }
  });

  it("rechaza el número, la fecha y la autorización fuera de formato, y una fecha posterior a la emisión", () => {
    expect(codes({ draft: withSupport({ number: "00100100000012" }) })).toEqual([
      at("WITHHOLDING_SUPPORT_INVALID", { support: 1 }),
    ]);
    expect(codes({ draft: withSupport({ authorizationNumber: "12345" }) })).toEqual([
      at("WITHHOLDING_SUPPORT_INVALID", { support: 1 }),
    ]);
    expect(codes({ draft: withSupport({ authorizationNumber: null }) })).toEqual([]);
    expect(codes({ draft: withSupport({ issueDate: "2026-02-30" }) })).toEqual([
      at("WITHHOLDING_SUPPORT_INVALID", { support: 1 }),
    ]);
    expect(codes({ draft: withSupport({ issueDate: "2026-10-07" }) })).toEqual([
      at("WITHHOLDING_SUPPORT_DATE_AFTER_ISSUE", { support: 1 }),
    ]);
    expect(codes({ draft: withSupport({ issueDate: ISSUE_DATE }) })).toEqual([]);
  });

  it("los campos que faltan dejan el borrador incompleto, en su documento", () => {
    const result = codes({
      draft: withSupport({
        documentType: null,
        supportCode: null,
        number: null,
        issueDate: null,
        totalWithoutTaxes: null,
        importTotal: null,
        taxes: [],
        payments: [],
        withholdings: [],
      }),
    });
    expect(result).toEqual([
      ...Array.from({ length: 8 }, () => at("WITHHOLDING_DRAFT_INCOMPLETE", { support: 1 })),
      at("WITHHOLDING_ITEMS_REQUIRED", { support: 1 }),
    ]);
    // El mensaje identifica el documento, también cuando la emisión informa solo el primero.
    const second = evaluate({
      draft: { supports: [SUPPORT, { ...SUPPORT, withholdings: [] }] },
    });
    expect(second.issues.map((i) => [i.code, i.support, i.message])).toEqual([
      [
        "WITHHOLDING_ITEMS_REQUIRED",
        2,
        "El documento sustento 2 no tiene retenciones: agrega al menos una.",
      ],
    ]);
  });

  it("los importes declarados se transcriben: ni sumas ni comparaciones ni recálculos", () => {
    const result = evaluate({
      draft: withSupport({
        totalWithoutTaxes: "1.00",
        importTotal: "999.99",
        taxes: [{ tax: "2", rateEntryKey: "4", rate: null, base: "50.00", amount: "1.23" }],
        payments: [{ paymentMethod: "20", total: "0.01" }],
        withholdings: [item("1", "312C", "5000.00")],
      }),
    });
    expect(result.issues).toEqual([]);
    expect(result.supports[0]?.taxes[0]).toMatchObject({ base: "50.00", amount: "1.23" });
    expect(result.supports[0]?.totalWithoutTaxes).toBe("1.00");
    expect(result.computed[0]?.amount).toBe("87.50");
  });
});

describe("impuestos declarados del documento sustento (design D6)", () => {
  const tax = (overrides: Record<string, string | null>) => ({
    draft: withSupport({
      taxes: [
        { tax: "2", rateEntryKey: "4", rate: null, base: "100.00", amount: "15.00", ...overrides },
      ],
    }),
  });

  it("acepta IVA, IVA con ICE, IRBPNR y varias entradas, con la tarifa del catálogo o declarada", () => {
    const result = evaluate({
      draft: withSupport({
        taxes: [
          { tax: "2", rateEntryKey: "4", rate: null, base: "100.00", amount: "15.00" },
          { tax: "3", rateEntryKey: "3011", rate: "150", base: "20.00", amount: "30.00" },
          { tax: "5", rateEntryKey: "5001", rate: "0.02", base: "10.00", amount: "0.20" },
          { tax: "2", rateEntryKey: "7", rate: null, base: "40.00", amount: "0.00" },
          { tax: "2", rateEntryKey: "6", rate: null, base: "5.00", amount: "0.00" },
        ],
      }),
    });
    expect(result.issues).toEqual([]);
    expect(
      result.supports[0]?.taxes.map((t) => [t.tax, t.rate.code, t.tariff, t.tariffBasis]),
    ).toEqual([
      ["2", "4", "15", "CATALOG"],
      ["3", "3011", "150", "USER_DECLARED"],
      ["5", "5001", "0.02", "USER_DECLARED"],
      ["2", "7", "0", "CATALOG"],
      ["2", "6", "0", "CATALOG"],
    ]);
  });

  it("resuelve el código con la fecha del documento: un ICE no vigente en esa fecha se rechaza", () => {
    // Los códigos de ICE rigen desde la base del proyecto (27/07/2026).
    expect(
      codes({
        draft: withSupport({
          issueDate: "2026-07-01",
          taxes: [{ tax: "3", rateEntryKey: "3011", rate: "150", base: "20.00", amount: "30.00" }],
        }),
      }),
    ).toEqual([at("WITHHOLDING_SUPPORT_TAX_INVALID", { support: 1, tax: 1 })]);
    expect(
      codes({
        draft: withSupport({
          issueDate: "2026-07-27",
          taxes: [{ tax: "3", rateEntryKey: "3011", rate: "150", base: "20.00", amount: "30.00" }],
        }),
      }),
    ).toEqual([]);
  });

  it("rechaza el IVA diferenciado, una tarifa enviada para el IVA y un código inexistente", () => {
    expect(codes(tax({ rateEntryKey: "8" }))).toEqual([
      at("WITHHOLDING_SUPPORT_TAX_INVALID", { support: 1, tax: 1 }),
    ]);
    expect(codes(tax({ rate: "15" }))).toEqual([
      at("WITHHOLDING_SUPPORT_TAX_INVALID", { support: 1, tax: 1 }),
    ]);
    expect(codes(tax({ rateEntryKey: "99" }))).toEqual([
      at("WITHHOLDING_SUPPORT_TAX_INVALID", { support: 1, tax: 1 }),
    ]);
    expect(codes(tax({ tax: "1" }))).toEqual([
      at("WITHHOLDING_SUPPORT_TAX_INVALID", { support: 1, tax: 1 }),
    ]);
  });

  it("ICE e IRBPNR exigen su tarifa declarada dentro del dominio de 3 dígitos", () => {
    expect(codes(tax({ tax: "3", rateEntryKey: "3011", rate: null }))).toEqual([
      at("WITHHOLDING_DRAFT_INCOMPLETE", { support: 1, tax: 1 }),
    ]);
    expect(codes(tax({ tax: "3", rateEntryKey: "3011", rate: "1000" }))).toEqual([
      at("WITHHOLDING_SUPPORT_TAX_INVALID", { support: 1, tax: 1 }),
    ]);
  });

  it("un ICE no necesita estar habilitado en la empresa: es el impuesto del proveedor", () => {
    expect(
      codes({
        disabled: { "ice-rate": new Set(["3011"]) },
        draft: withSupport({
          taxes: [{ tax: "3", rateEntryKey: "3011", rate: "150", base: "20.00", amount: "30.00" }],
        }),
      }),
    ).toEqual([]);
  });
});

describe("formas de pago del documento sustento (design D6)", () => {
  it("exigen una forma de pago utilizable para la empresa en la fecha de emisión", () => {
    expect(codes({ disabled: { "payment-method": new Set(["20"]) } })).toEqual([
      at("WITHHOLDING_SUPPORT_PAYMENT_NOT_USABLE", { support: 1, payment: 1 }),
    ]);
    // Un código de la tabla 13 del ATS cerrado en 2016 no está en el catálogo.
    expect(
      codes({ draft: withSupport({ payments: [{ paymentMethod: "02", total: "1.00" }] }) }),
    ).toEqual([at("WITHHOLDING_SUPPORT_PAYMENT_NOT_USABLE", { support: 1, payment: 1 })]);
    expect(
      codes({ draft: withSupport({ payments: [{ paymentMethod: "20", total: "-1" }] }) }),
    ).toEqual([at("WITHHOLDING_SUPPORT_INVALID", { support: 1, payment: 1 })]);
  });
});

describe("retenciones de cada documento (design D7 a D9 y D13)", () => {
  const withItems = (...withholdings: ReturnType<typeof item>[]) => ({
    draft: withSupport({ withholdings }),
  });

  it("rechaza los conceptos de renta fuera de alcance con su razón", () => {
    for (const [entryKey, reason] of [
      ["346", "porcentaje variable"],
      ["500", "los pagos al exterior están fuera del alcance actual"],
      ["325", "los dividendos están fuera del alcance actual"],
      ["3250", "los dividendos están fuera del alcance actual"],
      ["340", "estructura especial"],
      ["332H", "estructura especial"],
      ["323-M", "representación exacta"],
    ] as const) {
      const result = evaluate(withItems(item("1", entryKey)));
      expect(
        result.issues.map((i) => [i.code, i.support, i.withholding]),
        entryKey,
      ).toEqual([["WITHHOLDING_CONCEPT_NOT_SUPPORTED", 1, 1]]);
      expect(result.issues[0]?.message).toContain(reason);
    }
  });

  it("rechaza el código 8 del IVA sin convertirlo en una retención del 0 %", () => {
    const result = evaluate(withItems(item("2", "8", "15.00")));
    expect(result.issues.map((i) => [i.code, i.withholding])).toEqual([
      ["WITHHOLDING_IVA_CODE_NOT_SUPPORTED", 1],
    ]);
    expect(result.computed).toEqual([]);
    expect(result.amounts).toBeNull();
    expect(result.issues[0]?.message).toContain("no se emite como retención en el alcance actual");
  });

  it("rechaza el ISD y cualquier otro impuesto a retener", () => {
    for (const tax of ["6", "3", "5"]) {
      expect(codes(withItems(item(tax, "4580"))), tax).toEqual([
        at("WITHHOLDING_TAX_NOT_SUPPORTED", { support: 1, withholding: 1 }),
      ]);
    }
    expect(evaluate(withItems(item("6", "4580"))).issues[0]?.message).toContain(
      "el ISD y los demás impuestos están fuera del alcance actual",
    );
  });

  it("un concepto que dejó de estar vigente antes de la emisión se informa y bloquea la emisión", () => {
    // Una versión posterior del catálogo cierra la vigencia del 312C el día anterior a la emisión.
    const catalogs = catalogsFor(DRAFT.supports);
    const concept = catalogs.incomeConcepts.get("312C")!;
    const incomeConcepts = new Map(catalogs.incomeConcepts);
    incomeConcepts.set("312C", { ...concept, applicable: null, usable: false });
    const result = evaluate({ catalogs: { ...catalogs, incomeConcepts } });
    expect(result.issues.map((i) => [i.code, i.support, i.withholding, i.message])).toEqual([
      [
        "WITHHOLDING_ENTRY_NOT_USABLE",
        1,
        1,
        "El concepto de renta 312C no está vigente en la fecha de emisión.",
      ],
    ]);
    // Sin todas las retenciones calculadas no hay total: la emisión no puede reservar.
    expect(result.amounts).toBeNull();
  });

  it("una entrada inexistente, sin vigencia o deshabilitada no es utilizable", () => {
    expect(codes(withItems(item("1", "999")))).toEqual([
      at("WITHHOLDING_ENTRY_NOT_USABLE", { support: 1, withholding: 1 }),
    ]);
    // El bloque vigente del Catálogo ATS rige desde el 06/08/2026, y la tabla 4 desde su fecha de
    // actualización: antes, ni el tipo de documento ni el concepto son utilizables.
    expect(
      codes({
        issueDate: "2026-08-05",
        draft: {
          fiscalPeriod: "08/2026",
          supports: [{ ...SUPPORT, issueDate: "2026-08-01", withholdings: [item("1", "303")] }],
        },
      }),
    ).toEqual([
      at("WITHHOLDING_SUPPORT_TYPE_NOT_SUPPORTED", { support: 1 }),
      at("WITHHOLDING_ENTRY_NOT_USABLE", { support: 1, withholding: 1 }),
    ]);
    expect(
      codes({
        disabled: { "withholding-income-concept": new Set(["303"]) },
        ...withItems(item("1", "303")),
      }),
    ).toEqual([at("WITHHOLDING_ENTRY_NOT_USABLE", { support: 1, withholding: 1 })]);
    expect(
      codes({ disabled: { "withholding-iva-code": new Set(["7"]) }, ...withItems(item("2", "7")) }),
    ).toEqual([at("WITHHOLDING_ENTRY_NOT_USABLE", { support: 1, withholding: 1 })]);
  });

  it("la base debe ser positiva; los campos que faltan dejan el borrador incompleto", () => {
    expect(codes(withItems(item("1", "303", "0")))).toEqual([
      at("WITHHOLDING_BASE_INVALID", { support: 1, withholding: 1 }),
    ]);
    expect(codes(withItems(item(null, null, null)))).toEqual([
      at("WITHHOLDING_DRAFT_INCOMPLETE", { support: 1, withholding: 1 }),
      at("WITHHOLDING_DRAFT_INCOMPLETE", { support: 1, withholding: 1 }),
      at("WITHHOLDING_DRAFT_INCOMPLETE", { support: 1, withholding: 1 }),
    ]);
  });

  it("las retenciones válidas se calculan aunque otra no lo sea, sin total", () => {
    const result = evaluate(withItems(item("1", "303", "100.00"), item("1", "346", "50.00")));
    expect(result.computed.map((c) => [c.position, c.amount])).toEqual([[1, "10.00"]]);
    expect(result.amounts).toBeNull();
  });

  it("un valor que no cabe en el comprobante se informa en su retención", () => {
    expect(codes(withItems(item("2", "3", "99999999999999")))).toEqual([
      at("WITHHOLDING_AMOUNT_OUT_OF_RANGE", { support: 1, withholding: 1 }),
    ]);
  });
});

describe("contribuyente especial y preparación de la empresa", () => {
  it("rechaza un número de contribuyente especial que la retención 2.0.0 no admite", () => {
    expect(codes({ specialTaxpayerNumber: "123456" })).toEqual([
      at("WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE"),
    ]);
    expect(codes({ specialTaxpayerNumber: "12" })).toEqual([
      at("WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE"),
    ]);
    expect(codes({ specialTaxpayerNumber: "12345" })).toEqual([]);
    expect(codes({ specialTaxpayerNumber: "123" })).toEqual([]);
  });

  it("informa la preparación de la empresa al final, en el orden de D15", () => {
    const readiness = [
      {
        code: "TAXPAYER_NOT_CONFIGURED" as const,
        message: "x",
        support: null,
        tax: null,
        payment: null,
        withholding: null,
      },
    ];
    expect(codes({ readiness, draft: { relatedParty: null } })).toEqual([
      at("WITHHOLDING_RELATED_PARTY_REQUIRED"),
      at("TAXPAYER_NOT_CONFIGURED"),
    ]);
  });

  it("los problemas siguen el orden de design D15", () => {
    const result = codes({
      draft: {
        ...DRAFT,
        relatedParty: null,
        fiscalPeriod: "12/2026",
        supports: [{ ...SUPPORT, number: "1", withholdings: [item("1", "346")] }],
      },
      specialTaxpayerNumber: "1234567",
    });
    expect(result.map((i) => i.code)).toEqual([
      "WITHHOLDING_RELATED_PARTY_REQUIRED",
      "WITHHOLDING_FISCAL_PERIOD_IN_FUTURE",
      "WITHHOLDING_SUPPORT_INVALID",
      "WITHHOLDING_CONCEPT_NOT_SUPPORTED",
      "WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE",
    ]);
  });
});

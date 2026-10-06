// Contratos de los comprobantes de retención (add-withholding-receipts, tarea 3.1, design D3 a D6,
// D9, D10, D21 y D25): cuerpos estrictos sin porcentaje, denominación, valor retenido, empresa ni
// campos del exterior, de reembolso o de dividendos; período MM/AAAA; documentos 01, 02 y 03 como
// códigos de dos caracteres; número de 15 dígitos; autorización de 10, 37 o 49; impuestos del
// documento 2, 3 y 5 sin tarifa para el IVA; retenciones de renta e IVA con base exacta mayor que
// cero; y los máximos absolutos de los límites de recursos.
import { describe, expect, it } from "vitest";
import {
  SUPPORT_DOCUMENT_TYPES,
  WITHHOLDING_ERROR_CODES,
  WITHHOLDING_LIMITS_DEFAULT,
  WITHHOLDING_LIMITS_MAX,
  createWithholdingDraftSchema,
  emitWithholdingReceiptSchema,
  listWithholdingReceiptsQuerySchema,
  updateWithholdingDraftSchema,
  withholdingPreviewViewSchema,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

const TAX = { tax: "2", rateEntryKey: "4", base: "100.00", amount: "15.00" };
const PAYMENT = { paymentMethod: "20", total: "115.00" };
const ITEM = { tax: "1", entryKey: "312C", base: "100.29" };
const SUPPORT = {
  documentType: "01",
  supportCode: "01",
  number: "001001000000123",
  issueDate: "2026-10-01",
  authorizationNumber: "1".repeat(49),
  totalWithoutTaxes: "100.00",
  importTotal: "115.00",
  taxes: [TAX],
  payments: [PAYMENT],
  withholdings: [ITEM],
};
const draft = (overrides: Record<string, unknown> = {}) => ({
  partyId: "party-1",
  relatedParty: "NO",
  fiscalPeriod: "10/2026",
  emissionPointId: "point-1",
  supports: [SUPPORT],
  ...overrides,
});
const withSupport = (support: Record<string, unknown>) =>
  draft({ supports: [{ ...SUPPORT, ...support }] });
const parses = (value: unknown) => createWithholdingDraftSchema.safeParse(value);

describe("borrador de retención", () => {
  it("acepta un borrador completo y uno vacío, con los campos ausentes como null", () => {
    expect(parses(draft()).success).toBe(true);
    expect(createWithholdingDraftSchema.parse({})).toEqual({
      partyId: null,
      relatedParty: null,
      fiscalPeriod: null,
      emissionPointId: null,
      supports: [],
    });
    expect(createWithholdingDraftSchema.parse({ supports: [{}] }).supports[0]).toMatchObject({
      documentType: null,
      taxes: [],
      payments: [],
      withholdings: [],
    });
  });

  it("rechaza un porcentaje, una denominación o un valor retenido en una retención", () => {
    for (const extra of [
      { percentage: "1.75" },
      { label: "Compras" },
      { amount: "1.76" },
      { code: "312C" },
    ]) {
      const result = parses(withSupport({ withholdings: [{ ...ITEM, ...extra }] }));
      expect(result.success, JSON.stringify(extra)).toBe(false);
      expect(messages(result)).toContain("La solicitud contiene campos no permitidos.");
    }
  });

  it("rechaza un companyId y los campos del exterior, de reembolso o de dividendos", () => {
    expect(parses(draft({ companyId: "otra" })).success).toBe(false);
    for (const extra of [
      { pagoLocExt: "02" },
      { paymentLocation: "02" },
      { country: "593" },
      { doubleTaxationTreaty: "SI" },
      { reimbursements: [] },
      { dividends: { fiscalYear: "2025" } },
      { bananaBoxes: 10 },
    ]) {
      expect(parses(withSupport(extra)).success, JSON.stringify(extra)).toBe(false);
    }
    expect(parses(draft({ subjectType: "01" })).success).toBe(false);
  });

  it("exige el período MM/AAAA y la parte relacionada SI o NO", () => {
    for (const fiscalPeriod of ["10/26", "2026-10", "13/2026", "00/2026", "1/2026", "10/1999"]) {
      expect(parses(draft({ fiscalPeriod })).success, fiscalPeriod).toBe(false);
    }
    expect(parses(draft({ fiscalPeriod: "01/2026" })).success).toBe(true);
    for (const relatedParty of ["SÍ", "si", true, "YES"]) {
      expect(parses(draft({ relatedParty })).success, String(relatedParty)).toBe(false);
    }
  });

  it("exige el número de 15 dígitos y una autorización de 10, 37 o 49", () => {
    for (const number of [
      "00100100000012",
      "001-001-000000123",
      "0010010000001234",
      "00100100000012A",
    ]) {
      expect(parses(withSupport({ number })).success, number).toBe(false);
    }
    for (const authorizationNumber of [
      "1".repeat(9),
      "1".repeat(11),
      "1".repeat(36),
      "1".repeat(48),
      "1".repeat(50),
    ]) {
      expect(
        parses(withSupport({ authorizationNumber })).success,
        authorizationNumber.length.toString(),
      ).toBe(false);
    }
    for (const authorizationNumber of ["1".repeat(10), "1".repeat(37), "1".repeat(49), null]) {
      expect(parses(withSupport({ authorizationNumber })).success).toBe(true);
    }
  });

  it("el tipo de documento es un código de dos caracteres 01, 02 o 03, nunca un número", () => {
    expect(SUPPORT_DOCUMENT_TYPES).toEqual(["01", "02", "03"]);
    for (const documentType of [1, 2, "1", "04", "41", "001"]) {
      expect(parses(withSupport({ documentType })).success, String(documentType)).toBe(false);
    }
    for (const documentType of ["01", "02", "03"]) {
      expect(
        createWithholdingDraftSchema.parse(withSupport({ documentType })).supports[0]?.documentType,
      ).toBe(documentType);
    }
    expect(parses(withSupport({ supportCode: 1 })).success).toBe(false);
    expect(parses(withSupport({ supportCode: "1" })).success).toBe(false);
  });

  it("los impuestos del documento son 2, 3 o 5, y la tarifa del IVA no se envía", () => {
    for (const tax of ["1", "4", "6", 2]) {
      expect(parses(withSupport({ taxes: [{ ...TAX, tax }] })).success, String(tax)).toBe(false);
    }
    const ivaWithRate = parses(withSupport({ taxes: [{ ...TAX, rate: "15" }] }));
    expect(ivaWithRate.success).toBe(false);
    expect(messages(ivaWithRate)).toContain("La tarifa del IVA sale del catálogo: no se envía.");
    expect(
      parses(
        withSupport({
          taxes: [{ tax: "3", rateEntryKey: "3011", rate: "150", base: "10.00", amount: "15.00" }],
        }),
      ).success,
    ).toBe(true);
    expect(
      parses(
        withSupport({
          taxes: [{ tax: "5", rateEntryKey: "5001", rate: "0.02", base: "1.00", amount: "0.02" }],
        }),
      ).success,
    ).toBe(true);
    // La tarifa declarada sigue el dominio de 3 dígitos del XSD de la retención.
    expect(
      parses(
        withSupport({
          taxes: [{ tax: "3", rateEntryKey: "3011", rate: "1000", base: "1.00", amount: "1.00" }],
        }),
      ).success,
    ).toBe(false);
  });

  it("las retenciones son de renta o IVA; ICE, IRBPNR e ISD se rechazan", () => {
    for (const tax of ["3", "5", "6", 1]) {
      expect(parses(withSupport({ withholdings: [{ ...ITEM, tax }] })).success, String(tax)).toBe(
        false,
      );
    }
    expect(
      parses(withSupport({ withholdings: [{ tax: "2", entryKey: "7", base: "15.00" }] })).success,
    ).toBe(true);
  });

  it("la base es texto decimal exacto mayor que cero con hasta 2 decimales", () => {
    for (const base of [100.29, "100.299", "0", "0.00", "-1.00", "1e2"]) {
      expect(parses(withSupport({ withholdings: [{ ...ITEM, base }] })).success, String(base)).toBe(
        false,
      );
    }
    expect(messages(parses(withSupport({ withholdings: [{ ...ITEM, base: "0" }] })))).toContain(
      "La base de la retención debe ser mayor que cero.",
    );
    for (const field of ["totalWithoutTaxes", "importTotal"]) {
      expect(parses(withSupport({ [field]: 100 })).success, field).toBe(false);
    }
  });

  it("no admite más elementos que los máximos absolutos", () => {
    expect(WITHHOLDING_LIMITS_MAX).toEqual({
      supports: 30,
      itemsPerSupport: 10,
      taxesPerSupport: 10,
      paymentsPerSupport: 10,
    });
    expect(WITHHOLDING_LIMITS_DEFAULT).toEqual({
      supports: 10,
      itemsPerSupport: 5,
      taxesPerSupport: 5,
      paymentsPerSupport: 5,
    });
    const times = <T>(n: number, value: T) => Array.from({ length: n }, () => value);
    expect(parses(draft({ supports: times(30, SUPPORT) })).success).toBe(true);
    expect(parses(draft({ supports: times(31, SUPPORT) })).success).toBe(false);
    for (const [field, value] of [
      ["withholdings", ITEM],
      ["taxes", TAX],
      ["payments", PAYMENT],
    ] as const) {
      expect(parses(withSupport({ [field]: times(10, value) })).success, field).toBe(true);
      expect(parses(withSupport({ [field]: times(11, value) })).success, field).toBe(false);
    }
  });

  it("la corrección exige la versión esperada", () => {
    expect(updateWithholdingDraftSchema.safeParse(draft()).success).toBe(false);
    expect(updateWithholdingDraftSchema.safeParse({ ...draft(), expectedVersion: 2 }).success).toBe(
      true,
    );
    expect(
      updateWithholdingDraftSchema.safeParse({ ...draft(), expectedVersion: "2" }).success,
    ).toBe(false);
  });
});

describe("emisión, consulta y vistas", () => {
  it("la emisión solo lleva el borrador y su versión", () => {
    expect(emitWithholdingReceiptSchema.parse({ draftId: "d-1", expectedVersion: 3 })).toEqual({
      draftId: "d-1",
      expectedVersion: 3,
    });
    expect(
      emitWithholdingReceiptSchema.safeParse({ draftId: "d-1", expectedVersion: 3, companyId: "x" })
        .success,
    ).toBe(false);
    expect(emitWithholdingReceiptSchema.safeParse({ draftId: "d-1" }).success).toBe(false);
  });

  it("la consulta filtra por estado y período, e ignora un companyId", () => {
    expect(
      listWithholdingReceiptsQuerySchema.parse({
        fiscalPeriod: "10/2026",
        state: "AUTHORIZED",
        companyId: "x",
      }),
    ).toEqual({ fiscalPeriod: "10/2026", state: "AUTHORIZED", page: 1, pageSize: 25 });
    expect(listWithholdingReceiptsQuerySchema.safeParse({ fiscalPeriod: "2026-10" }).success).toBe(
      false,
    );
  });

  it("la vista previa lleva porcentajes de 3 dígitos y valores como texto, y los problemas con su posición", () => {
    const preview = {
      evaluatedOn: "2026-10-06",
      issueMonth: "10/2026",
      periodDiffersFromIssueMonth: false,
      supports: [
        {
          position: 1,
          withholdings: [
            {
              position: 1,
              tax: "1",
              entryKey: "312C",
              code: "312C",
              label: "Compras",
              base: "100.29",
              percentage: "1.75",
              amount: "1.76",
            },
          ],
        },
      ],
      totals: { withheld: "1.76" },
      issues: [
        {
          code: "WITHHOLDING_BASE_INVALID",
          message: "x",
          support: 1,
          tax: null,
          payment: null,
          withholding: 1,
        },
      ],
    };
    expect(withholdingPreviewViewSchema.safeParse(preview).success).toBe(true);
    expect(
      withholdingPreviewViewSchema.safeParse({
        ...preview,
        supports: [
          {
            position: 1,
            withholdings: [{ ...preview.supports[0]!.withholdings[0]!, percentage: 1.75 }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("los códigos de error de design D21", () => {
    expect(WITHHOLDING_ERROR_CODES).toEqual(
      expect.arrayContaining([
        "WITHHOLDING_SUBJECT_CONSUMER_FINAL",
        "WITHHOLDING_SUBJECT_FOREIGN_OUT_OF_SCOPE",
        "WITHHOLDING_SUBJECT_NOT_SUPPLIER",
        "WITHHOLDING_SUBJECT_INACTIVE",
        "WITHHOLDING_RELATED_PARTY_REQUIRED",
        "WITHHOLDING_FISCAL_PERIOD_INVALID",
        "WITHHOLDING_FISCAL_PERIOD_IN_FUTURE",
        "WITHHOLDING_SUPPORTS_REQUIRED",
        "WITHHOLDING_SUPPORT_TYPE_NOT_SUPPORTED",
        "WITHHOLDING_SUPPORT_CODE_INCOMPATIBLE",
        "WITHHOLDING_SUPPORT_INVALID",
        "WITHHOLDING_SUPPORT_DATE_AFTER_ISSUE",
        "WITHHOLDING_SUPPORT_TAX_INVALID",
        "WITHHOLDING_SUPPORT_PAYMENT_NOT_USABLE",
        "WITHHOLDING_ITEMS_REQUIRED",
        "WITHHOLDING_TAX_NOT_SUPPORTED",
        "WITHHOLDING_CONCEPT_NOT_SUPPORTED",
        "WITHHOLDING_IVA_CODE_NOT_SUPPORTED",
        "WITHHOLDING_ENTRY_NOT_USABLE",
        "WITHHOLDING_BASE_INVALID",
        "WITHHOLDING_AMOUNT_OUT_OF_RANGE",
        "WITHHOLDING_RESOURCE_LIMIT",
        "WITHHOLDING_SPECIAL_TAXPAYER_INCOMPATIBLE",
        "WITHHOLDING_DRAFT_INCOMPLETE",
        "WITHHOLDING_DRAFT_CHANGED",
        "WITHHOLDING_DRAFT_ALREADY_EMITTED",
        "WITHHOLDING_NOT_RECONCILABLE",
        "IDEMPOTENCY_KEY_REQUIRED",
        "IDEMPOTENCY_KEY_REUSED",
      ]),
    );
  });
});

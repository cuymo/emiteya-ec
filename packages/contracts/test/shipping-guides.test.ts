// Contratos de las guías de remisión (add-shipping-guides, tarea 3.1, design D3 a D9, D14, D22 y D23):
// cuerpos estrictos, sustento tipado, datos derivados que no se envían, cantidades exactas mayores
// que cero y máximos absolutos como defensa de recursos.
import { describe, expect, it } from "vitest";
import {
  SHIPPING_EXCEPTION_CASES,
  SHIPPING_EXCEPTION_POLICY,
  SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION,
  SHIPPING_GUIDE_LIMITS_DEFAULT,
  SHIPPING_GUIDE_LIMITS_MAX,
  createShippingGuideDraftSchema,
  emitShippingGuideSchema,
  shippingDetailSchema,
  shippingQuantitySchema,
  shippingRecipientSchema,
  updateShippingGuideDraftSchema,
} from "@facturador/contracts";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

const detail = {
  productId: null,
  description: "10 cajas de 12 botellas de 1 litro",
  quantity: "10",
};
const recipient = {
  recipient: { kind: "PARTY", partyId: "p-1" },
  address: "Av. Simón Bolívar S/N",
  motive: "Venta",
  support: { kind: "INTERNAL_INVOICE", invoiceId: "inv-1" },
  details: [detail],
};
const draft = {
  emissionPointId: "pto-1",
  originEstablishmentId: null,
  departureAddress: "Bodega norte",
  transporter: { source: "SELF" },
  plate: "PAA-1234",
  transportStart: "2026-10-06",
  transportEnd: "2026-10-07",
  recipients: [recipient],
};

describe("borrador de la guía", () => {
  it("acepta un borrador completo y uno vacío", () => {
    expect(createShippingGuideDraftSchema.safeParse(draft).success).toBe(true);
    expect(createShippingGuideDraftSchema.parse({})).toMatchObject({
      transporter: null,
      recipients: [],
      fromInvoiceId: null,
    });
    expect(updateShippingGuideDraftSchema.safeParse({ ...draft, expectedVersion: 2 }).success).toBe(
      true,
    );
  });

  it("acepta el transporte de un tercero y el traslado a un establecimiento propio", () => {
    const parsed = createShippingGuideDraftSchema.safeParse({
      ...draft,
      originEstablishmentId: "est-1",
      departureAddress: null,
      transporter: { source: "PARTY", partyId: "carrier-1" },
      recipients: [
        {
          recipient: { kind: "OWN_COMPANY", destinationEstablishmentId: "est-2" },
          motive: "Traslado entre establecimientos",
          support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
          details: [detail],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rechaza un companyId, un precio, un impuesto, detalles adicionales, un documento aduanero o varias placas", () => {
    for (const body of [
      { ...draft, companyId: "otra" },
      { ...draft, plates: ["PAA-1234", "PBB-5678"] },
      {
        ...draft,
        transporters: [{ source: "SELF" }, { source: "PARTY", partyId: "carrier-2" }],
      },
      { ...draft, transporter: { source: "PARTY", partyId: "carrier-1", driver: "Juan" } },
      {
        ...draft,
        recipients: [
          {
            ...recipient,
            supportNumber: "001-001-000000001",
            supportAuthorization: "1".repeat(49),
            supportIssueDate: "2026-10-01",
          },
        ],
      },
      { ...draft, recipients: [{ ...recipient, customsDocument: "0041324846887" }] },
      { ...draft, recipients: [{ ...recipient, details: [{ ...detail, unitPrice: "1.00" }] }] },
      { ...draft, recipients: [{ ...recipient, details: [{ ...detail, tax: "2" }] }] },
      {
        ...draft,
        recipients: [{ ...recipient, details: [{ ...detail, additionalDetails: [] }] }],
      },
    ]) {
      expect(createShippingGuideDraftSchema.safeParse(body).success, JSON.stringify(body)).toBe(
        false,
      );
    }
  });

  it("rechaza un sustento escrito a mano, la venta itinerante o un caso desconocido", () => {
    for (const support of [
      { kind: "INTERNAL_INVOICE", invoiceId: "inv-1", number: "001-001-000000001" },
      { kind: "EXTERNAL_INVOICE", number: "001-001-000000001", authorization: "1".repeat(49) },
      { kind: "DECLARED_EXCEPTION", case: "ITINERANT_SALE" },
      { kind: "DECLARED_EXCEPTION", case: "OTRO" },
    ]) {
      expect(shippingRecipientSchema.safeParse({ ...recipient, support }).success).toBe(false);
    }
    expect(SHIPPING_EXCEPTION_CASES).not.toContain("ITINERANT_SALE");
    expect(
      messages(
        shippingRecipientSchema.safeParse({
          ...recipient,
          support: { kind: "DECLARED_EXCEPTION", case: "ITINERANT_SALE" },
        }),
      ).join(" "),
    ).toContain("La venta itinerante está fuera del alcance actual.");
  });

  it("rechaza los datos derivados: partida con origen, dirección o código de la propia empresa y códigos de un producto", () => {
    expect(
      messages(
        createShippingGuideDraftSchema.safeParse({ ...draft, originEstablishmentId: "est-1" }),
      ),
    ).toContain("Con un establecimiento de origen, la partida sale de su dirección: no se envía.");
    const own = {
      recipient: { kind: "OWN_COMPANY", destinationEstablishmentId: "est-2" },
      motive: "Traslado",
      support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
      details: [detail],
    };
    expect(shippingRecipientSchema.safeParse({ ...own, address: "Otra" }).success).toBe(false);
    expect(
      shippingRecipientSchema.safeParse({ ...own, destinationEstablishmentCode: "002" }).success,
    ).toBe(false);
    expect(
      messages(shippingDetailSchema.safeParse({ ...detail, productId: "prod-1", mainCode: "P-1" })),
    ).toContain("Los códigos de un producto salen del producto: no se envían.");
  });

  it("acepta una cantidad exacta de hasta 6 decimales y rechaza negativos, números y más dígitos; el cero se guarda y lo informa la vista previa", () => {
    for (const quantity of ["10.254632", "1", "999999999999.999999"]) {
      expect(shippingDetailSchema.safeParse({ ...detail, quantity }).success, quantity).toBe(true);
    }
    // El borrador guarda una cantidad cero para que la vista previa la informe con su posición; la
    // cantidad válida para emitir, la del formulario, la rechaza como política del sistema.
    expect(shippingDetailSchema.safeParse({ ...detail, quantity: "0" }).success).toBe(true);
    expect(messages(shippingQuantitySchema.safeParse("0"))).toContain(
      "La cantidad debe ser mayor que cero: es una política del sistema, aunque el XSD admita cero.",
    );
    for (const quantity of ["-1", "1.1234567", "1234567890123.000001", 10]) {
      expect(
        shippingDetailSchema.safeParse({ ...detail, quantity }).success,
        String(quantity),
      ).toBe(false);
    }
  });

  it("rechaza un código de destino que no tiene 3 dígitos y una placa de 21 caracteres", () => {
    for (const destinationEstablishmentCode of ["1A", "0001", "01"]) {
      expect(
        shippingRecipientSchema.safeParse({ ...recipient, destinationEstablishmentCode }).success,
      ).toBe(false);
    }
    expect(
      shippingRecipientSchema.safeParse({ ...recipient, destinationEstablishmentCode: "003" })
        .success,
    ).toBe(true);
    expect(
      createShippingGuideDraftSchema.safeParse({ ...draft, plate: "P".repeat(21) }).success,
    ).toBe(false);
    expect(createShippingGuideDraftSchema.safeParse({ ...draft, plate: "PAA\n1234" }).success).toBe(
      false,
    );
    // Los espacios de los extremos no cuentan para la longitud y no se guardan.
    const spaced = createShippingGuideDraftSchema.safeParse({
      ...draft,
      plate: `  ${"P".repeat(20)}  `,
    });
    expect([spaced.success, spaced.data?.plate]).toEqual([true, "P".repeat(20)]);
  });

  it("rechaza más elementos que los máximos absolutos, presentados como defensa de recursos", () => {
    const tooManyRecipients = Array.from(
      { length: SHIPPING_GUIDE_LIMITS_MAX.recipients + 1 },
      () => recipient,
    );
    const result = createShippingGuideDraftSchema.safeParse({
      ...draft,
      recipients: tooManyRecipients,
    });
    expect(messages(result).join(" ")).toContain("no un límite del SRI");
    const manyDetails = Array.from(
      { length: SHIPPING_GUIDE_LIMITS_MAX.detailsPerRecipient + 1 },
      () => detail,
    );
    expect(shippingRecipientSchema.safeParse({ ...recipient, details: manyDetails }).success).toBe(
      false,
    );
    // El global de detalles rige aunque cada destinatario esté dentro de su máximo.
    const four = Array.from({ length: 4 }, () => ({
      ...recipient,
      details: Array.from({ length: 80 }, () => detail),
    }));
    expect(
      messages(createShippingGuideDraftSchema.safeParse({ ...draft, recipients: four })),
    ).toContain(
      `La guía admite como máximo ${SHIPPING_GUIDE_LIMITS_MAX.details} detalles. Es una defensa de recursos del sistema, no un límite del SRI.`,
    );
    expect(SHIPPING_GUIDE_LIMITS_DEFAULT).toEqual({
      recipients: 10,
      detailsPerRecipient: 50,
      details: 100,
    });
  });

  it("desde una factura no se envían destinatarios", () => {
    expect(createShippingGuideDraftSchema.safeParse({ fromInvoiceId: "inv-1" }).success).toBe(true);
    expect(
      createShippingGuideDraftSchema.safeParse({ ...draft, fromInvoiceId: "inv-1" }).success,
    ).toBe(false);
  });
});

describe("emisión y política de excepciones", () => {
  it("la emisión lleva la confirmación de la declaración con su versión, o null", () => {
    expect(
      emitShippingGuideSchema.parse({ draftId: "d-1", expectedVersion: 1 }).exceptionDeclaration,
    ).toBeNull();
    expect(
      emitShippingGuideSchema.parse({
        draftId: "d-1",
        expectedVersion: 1,
        exceptionDeclaration: { policyVersion: SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION },
      }).exceptionDeclaration,
    ).toEqual({ policyVersion: 1 });
    expect(
      emitShippingGuideSchema.safeParse({
        draftId: "d-1",
        expectedVersion: 1,
        exceptionDeclaration: { policyVersion: 1, confirmedBy: "x" },
      }).success,
    ).toBe(false);
  });

  it("cada caso cita su literal del art. 30, numeral 8, y la clase de destinatario que admite", () => {
    expect(
      SHIPPING_EXCEPTION_CASES.map((value) => [
        SHIPPING_EXCEPTION_POLICY[value].literal,
        SHIPPING_EXCEPTION_POLICY[value].recipientKind,
      ]),
    ).toEqual([
      ["b", "PARTY"],
      ["c", "PARTY"],
      ["d", "OWN_COMPANY"],
      ["e", "PARTY"],
    ]);
    expect(SHIPPING_EXCEPTION_POLICY.OWN_ESTABLISHMENT_TRANSFER.statement).toBe(
      "Traslado entre establecimientos de un mismo contribuyente.",
    );
  });
});

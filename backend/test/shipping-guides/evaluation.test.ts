// Evaluación de la guía de remisión (add-shipping-guides, tarea 4.1, design D3 a D9, D12 y D23): cada
// rechazo con su código y su posición, los límites compuestos, las fechas, la partida con su origen,
// el traslado entre establecimientos propios sin comparar con el establecimiento del punto, y la
// factura a consumidor final como sustento con un destinatario identificado.
import { describe, expect, it } from "vitest";
import type { ShippingGuideDraftContent } from "../../src/modules/shipping-guides/domain/draft.ts";
import {
  evaluateShippingGuide,
  type GuideEstablishment,
  type GuideInvoice,
  type GuideParty,
  type GuideProduct,
  type ShippingGuideEvaluationInput,
} from "../../src/modules/shipping-guides/domain/evaluation.ts";

const party = (overrides: Partial<GuideParty> = {}): GuideParty => ({
  id: "p-1",
  status: "ACTIVE",
  identificationType: "04",
  identification: "1790012345001",
  legalName: "Comercial Andina S.A.",
  address: "Av. Amazonas N24",
  roles: [],
  consumerFinal: false,
  ...overrides,
});
const carrier = party({
  id: "c-1",
  identificationType: "05",
  identification: "1712345678",
  legalName: "Juan Torres",
  roles: ["CARRIER"],
});
const establishment = (id: string, code: string, active = true): GuideEstablishment => ({
  id,
  code,
  address: `Dirección ${code}`,
  active,
});
const product = (overrides: Partial<GuideProduct> = {}): GuideProduct => ({
  id: "prod-1",
  status: "ACTIVE",
  kind: "GOOD",
  mainCode: "CEM-50",
  auxiliaryCode: null,
  name: "Cemento 50 kg",
  ...overrides,
});
const invoice = (overrides: Partial<GuideInvoice> = {}): GuideInvoice => ({
  id: "inv-1",
  documentType: "01",
  documentNumber: "001-001-000000123",
  issueDate: "2026-10-05",
  accessKey: "0".repeat(49),
  environment: "TEST",
  state: "AUTHORIZED",
  authorization: {
    number: "0".repeat(49),
    date: new Date("2026-10-05T15:00:00Z"),
    environment: "TEST",
  },
  intact: true,
  ...overrides,
});

const detail = {
  productId: null,
  mainCode: null,
  auxiliaryCode: null,
  description: "10 cajas de 12 botellas de 1 litro",
  quantity: "10",
};
const recipient = {
  recipient: { kind: "PARTY" as const, partyId: "p-1" },
  address: "Av. Simón Bolívar S/N",
  motive: "Venta",
  route: null,
  destinationEstablishmentCode: null,
  support: { kind: "INTERNAL_INVOICE" as const, invoiceId: "inv-1" },
  details: [detail],
};
const draft: Omit<ShippingGuideDraftContent, "emissionPointId"> = {
  originEstablishmentId: null,
  departureAddress: "Bodega norte",
  transporter: { source: "SELF" },
  plate: "PAA-1234",
  transportStart: "2026-10-06",
  transportEnd: "2026-10-07",
  recipients: [recipient],
};

function evaluate(
  changes: Partial<Omit<ShippingGuideDraftContent, "emissionPointId">> = {},
  extra: Partial<ShippingGuideEvaluationInput> = {},
) {
  return evaluateShippingGuide({
    issueDate: "2026-10-06",
    environment: "TEST",
    draft: { ...draft, ...changes },
    company: { ruc: "1790000000001", legalName: "Distribuidora Nacional S.A." },
    parties: new Map([
      ["p-1", party()],
      ["c-1", carrier],
    ]),
    establishments: new Map([
      ["est-1", establishment("est-1", "001")],
      ["est-2", establishment("est-2", "002")],
      ["est-3", establishment("est-3", "003", false)],
    ]),
    products: new Map([
      ["prod-1", product()],
      ["aux-1", product({ id: "aux-1", mainCode: "VAR-12", auxiliaryCode: "AUX-12" })],
      ["svc-1", product({ id: "svc-1", kind: "SERVICE", name: "Instalación" })],
      ["old-1", product({ id: "old-1", status: "INACTIVE" })],
    ]),
    invoices: new Map([["inv-1", invoice()]]),
    limits: { recipients: 10, detailsPerRecipient: 50, details: 100 },
    ...extra,
  });
}
const codes = (result: ReturnType<typeof evaluate>) =>
  result.issues.map((issue) => [issue.code, issue.field ?? issue.recipient, issue.detail]);

describe("evaluación de la guía de remisión", () => {
  it("una guía completa no tiene problemas y queda resuelta", () => {
    const result = evaluate();
    expect(result.issues).toEqual([]);
    expect(result.guide).toMatchObject({
      departure: { source: "FREE_TEXT", address: "Bodega norte" },
      carrier: { source: "SELF", identificationType: "04", identification: "1790000000001" },
      recipients: [
        {
          identification: "1790012345001",
          support: { kind: "INTERNAL_INVOICE" },
          details: [{ quantity: "10" }],
        },
      ],
      counts: { recipients: 1, details: 1 },
    });
    expect(result.exceptionDeclarationRequired).toBe(false);
  });

  describe("transportista", () => {
    it("un tercero con el rol de transportista y una cédula se resuelve con su tipo", () => {
      expect(evaluate({ transporter: { source: "PARTY", partyId: "c-1" } }).carrier).toEqual({
        source: "PARTY",
        partyId: "c-1",
        identificationType: "05",
        identification: "1712345678",
        legalName: "Juan Torres",
      });
    });

    it("rechaza un transporte sin elegir, un tercero inexistente, inactivo, sin rol, del exterior o con identificación larga", () => {
      const cases: [Partial<GuideParty> | null, string][] = [
        [null, "SHIPPING_GUIDE_CARRIER_NOT_FOUND"],
        [{ status: "INACTIVE" }, "SHIPPING_GUIDE_CARRIER_INACTIVE"],
        [{ roles: [] }, "SHIPPING_GUIDE_CARRIER_ROLE_REQUIRED"],
        [{ identificationType: "08" }, "SHIPPING_GUIDE_CARRIER_FOREIGN_OUT_OF_SCOPE"],
        [
          { identificationType: "07", consumerFinal: true },
          "SHIPPING_GUIDE_CARRIER_CONSUMER_FINAL",
        ],
        [
          { identificationType: "06", identification: "P".repeat(15) },
          "SHIPPING_GUIDE_CARRIER_IDENTIFICATION_TOO_LONG",
        ],
      ];
      for (const [changes, code] of cases) {
        const parties = new Map([["p-1", party()]]);
        if (changes) parties.set("c-1", { ...carrier, ...changes });
        const result = evaluate({ transporter: { source: "PARTY", partyId: "c-1" } }, { parties });
        expect(codes(result)).toContainEqual([code, "transporter", null]);
        expect(result.guide).toBeNull();
      }
      expect(codes(evaluate({ transporter: null }))).toContainEqual([
        "SHIPPING_GUIDE_CARRIER_REQUIRED",
        "transporter",
        null,
      ]);
      // El mensaje del rol pide configurarlo; nada lo asigna.
      const parties = new Map([
        ["c-1", { ...carrier, roles: [] }],
        ["p-1", party()],
      ]);
      const roleless = evaluate({ transporter: { source: "PARTY", partyId: "c-1" } }, { parties });
      expect(roleless.issues[0]?.message).toContain("configúralo como transportista en Terceros");
    });
  });

  it("una identificación de más de 13 caracteres se rechaza citando el máximo y su fuente", () => {
    const parties = new Map([
      ["c-1", { ...carrier, identificationType: "06", identification: "PAS12345678901" }],
    ]);
    const result = evaluate({ transporter: { source: "PARTY", partyId: "c-1" } }, { parties });
    const issue = result.issues.find(
      (candidate) => candidate.code === "SHIPPING_GUIDE_CARRIER_IDENTIFICATION_TOO_LONG",
    );
    expect(issue?.message).toBe(
      "La identificación del transportista tiene 14 caracteres, y la guía admite como máximo 13 (Ficha técnica v2.34, anexo 3, página 70).",
    );
  });

  describe("placa y fechas", () => {
    it("recorta la placa, acepta cualquier formato y rechaza vacía o larga", () => {
      expect(evaluate({ plate: "  MAQN99999 " }).guide?.plate).toBe("MAQN99999");
      expect(evaluate({ plate: "123" }).issues).toEqual([]);
      for (const plate of [null, "   ", "P".repeat(21)]) {
        expect(codes(evaluate({ plate }))).toContainEqual([
          "SHIPPING_GUIDE_PLATE_INVALID",
          "plate",
          null,
        ]);
      }
    });

    it("acepta el inicio el mismo día de la emisión y un traslado de 60 días", () => {
      expect(evaluate({ transportStart: "2026-10-06", transportEnd: "2026-10-06" }).issues).toEqual(
        [],
      );
      expect(evaluate({ transportEnd: "2026-12-05" }).issues).toEqual([]);
    });

    it("rechaza el inicio anterior a la emisión citando el error 82, el fin anterior al inicio y fechas inválidas", () => {
      const before = evaluate({ transportStart: "2026-10-05" });
      expect(codes(before)).toContainEqual([
        "SHIPPING_GUIDE_START_BEFORE_ISSUE",
        "transportStart",
        null,
      ]);
      expect(before.issues[0]?.message).toContain("error 82");
      const reversed = evaluate({ transportEnd: "2026-10-05" });
      expect(codes(reversed)).toContainEqual([
        "SHIPPING_GUIDE_END_BEFORE_START",
        "transportEnd",
        null,
      ]);
      // Es una validación del sistema, no del SRI.
      expect(
        reversed.issues.find((issue) => issue.code === "SHIPPING_GUIDE_END_BEFORE_START")?.message,
      ).toContain("validación del sistema, no del SRI");
      for (const transportStart of ["2026-02-30", "1999-12-31", "2100-01-01"]) {
        expect(codes(evaluate({ transportStart, transportEnd: "2026-10-07" }))).toContainEqual([
          "SHIPPING_GUIDE_DATE_INVALID",
          "transportStart",
          null,
        ]);
      }
      // Un borrador de ayer emitido hoy: la evaluación compara con la fecha que recibe.
      expect(
        codes(evaluate({ transportStart: "2026-10-06" }, { issueDate: "2026-10-07" })),
      ).toContainEqual(["SHIPPING_GUIDE_START_BEFORE_ISSUE", "transportStart", null]);
    });
  });

  describe("partida y traslado entre establecimientos propios", () => {
    const own = (destinationEstablishmentId: string) => ({
      ...recipient,
      recipient: { kind: "OWN_COMPANY" as const, destinationEstablishmentId },
      address: null,
      destinationEstablishmentCode: null,
      support: { kind: "DECLARED_EXCEPTION" as const, case: "OWN_ESTABLISHMENT_TRANSFER" as const },
    });

    it("con origen, la partida es la dirección del establecimiento y el destino aporta dirección y código", () => {
      const result = evaluate({
        originEstablishmentId: "est-1",
        departureAddress: null,
        recipients: [own("est-2")],
      });
      expect(result.issues).toEqual([]);
      expect(result.guide?.departure).toEqual({
        source: "ESTABLISHMENT",
        establishment: { id: "est-1", code: "001", address: "Dirección 001" },
        address: "Dirección 001",
      });
      expect(result.guide?.recipients[0]).toMatchObject({
        kind: "OWN_COMPANY",
        identification: "1790000000001",
        legalName: "Distribuidora Nacional S.A.",
        address: "Dirección 002",
        destinationEstablishmentCode: "002",
        destination: { id: "est-2", code: "002" },
      });
      expect(result.exceptionDeclarationRequired).toBe(true);
    });

    it("no compara con el establecimiento del punto: el emisor puede ser origen, destino u otro", () => {
      // La evaluación no recibe el establecimiento del punto: la misma guía es válida desde cualquiera.
      expect(
        evaluate({
          originEstablishmentId: "est-1",
          departureAddress: null,
          recipients: [own("est-2")],
        }).issues,
      ).toEqual([]);
    });

    it("rechaza el mismo establecimiento, el origen ausente con dirección libre y establecimientos inactivos", () => {
      expect(
        codes(
          evaluate({
            originEstablishmentId: "est-1",
            departureAddress: null,
            recipients: [own("est-1")],
          }),
        ),
      ).toContainEqual(["SHIPPING_GUIDE_SAME_ESTABLISHMENT", 1, null]);
      expect(codes(evaluate({ recipients: [own("est-2")] }))).toContainEqual([
        "SHIPPING_GUIDE_ORIGIN_ESTABLISHMENT_REQUIRED",
        "originEstablishmentId",
        null,
      ]);
      expect(
        codes(
          evaluate({
            originEstablishmentId: "est-3",
            departureAddress: null,
            recipients: [own("est-2")],
          }),
        ),
      ).toContainEqual(["SHIPPING_GUIDE_ESTABLISHMENT_INACTIVE", "originEstablishmentId", null]);
      expect(
        codes(
          evaluate({
            originEstablishmentId: "est-1",
            departureAddress: null,
            recipients: [own("est-3")],
          }),
        ),
      ).toContainEqual(["SHIPPING_GUIDE_ESTABLISHMENT_INACTIVE", 1, null]);
      expect(codes(evaluate({ departureAddress: "  " }))).toContainEqual([
        "SHIPPING_GUIDE_DEPARTURE_ADDRESS_INVALID",
        "departureAddress",
        null,
      ]);
    });

    it("rechaza la propia empresa con otra clase de sustento y un tercero con la excepción propia", () => {
      expect(
        codes(
          evaluate({
            originEstablishmentId: "est-1",
            departureAddress: null,
            recipients: [
              { ...own("est-2"), support: { kind: "INTERNAL_INVOICE", invoiceId: "inv-1" } },
            ],
          }),
        ),
      ).toContainEqual(["SHIPPING_GUIDE_EXCEPTION_RECIPIENT_MISMATCH", 1, null]);
      expect(
        codes(
          evaluate({
            originEstablishmentId: "est-1",
            departureAddress: null,
            recipients: [
              { ...own("est-2"), support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" } },
            ],
          }),
        ),
      ).toContainEqual(["SHIPPING_GUIDE_EXCEPTION_RECIPIENT_MISMATCH", 1, null]);
      expect(
        codes(
          evaluate({
            originEstablishmentId: "est-1",
            departureAddress: null,
            recipients: [
              {
                ...recipient,
                support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
              },
            ],
          }),
        ),
      ).toContainEqual(["SHIPPING_GUIDE_EXCEPTION_RECIPIENT_MISMATCH", 1, null]);
    });
  });

  describe("destinatarios y sustento", () => {
    it("rechaza sin destinatarios, un tercero inexistente, inactivo, consumidor final o del exterior, y sin dirección ni motivo", () => {
      expect(codes(evaluate({ recipients: [] }))).toContainEqual([
        "SHIPPING_GUIDE_RECIPIENTS_REQUIRED",
        "recipients",
        null,
      ]);
      for (const [changes, code] of [
        [{ status: "INACTIVE" }, "SHIPPING_GUIDE_RECIPIENT_INACTIVE"],
        [
          { consumerFinal: true, identificationType: "07" },
          "SHIPPING_GUIDE_RECIPIENT_CONSUMER_FINAL",
        ],
        [{ identificationType: "08" }, "SHIPPING_GUIDE_RECIPIENT_FOREIGN_OUT_OF_SCOPE"],
      ] as const) {
        const parties = new Map([["p-1", party(changes)]]);
        expect(codes(evaluate({}, { parties }))).toContainEqual([code, 1, null]);
      }
      expect(codes(evaluate({}, { parties: new Map() }))).toContainEqual([
        "SHIPPING_GUIDE_RECIPIENT_NOT_FOUND",
        1,
        null,
      ]);
      expect(codes(evaluate({ recipients: [{ ...recipient, address: " " }] }))).toContainEqual([
        "SHIPPING_GUIDE_ADDRESS_REQUIRED",
        1,
        null,
      ]);
      expect(codes(evaluate({ recipients: [{ ...recipient, motive: null }] }))).toContainEqual([
        "SHIPPING_GUIDE_MOTIVE_REQUIRED",
        1,
        null,
      ]);
    });

    it("el mismo tercero puede ser destinatario dos veces con dos facturas distintas", () => {
      const invoices = new Map([
        ["inv-1", invoice()],
        ["inv-2", invoice({ id: "inv-2", documentNumber: "001-001-000000124" })],
      ]);
      const result = evaluate(
        {
          recipients: [
            recipient,
            { ...recipient, support: { kind: "INTERNAL_INVOICE", invoiceId: "inv-2" } },
          ],
        },
        { invoices },
      );
      expect(result.issues).toEqual([]);
      expect(
        result.guide?.recipients.map((r) => [
          r.partyId,
          r.support.kind === "INTERNAL_INVOICE" ? r.support.invoice.documentNumber : null,
        ]),
      ).toEqual([
        ["p-1", "001-001-000000123"],
        ["p-1", "001-001-000000124"],
      ]);
    });

    it("el código de destino de un tercero es el declarado, sin verificarlo, y sin él no toma el del establecimiento emisor", () => {
      const result = evaluate({
        recipients: [{ ...recipient, destinationEstablishmentCode: "003" }, recipient],
      });
      expect(result.issues).toEqual([]);
      expect(result.guide?.recipients.map((r) => r.destinationEstablishmentCode)).toEqual([
        "003",
        null,
      ]);
    });

    it("un tercero sin roles es destinatario y el mismo tercero puede repetirse", () => {
      const result = evaluate({
        recipients: [
          recipient,
          { ...recipient, support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" } },
        ],
      });
      expect(result.issues).toEqual([]);
      expect(result.guide?.recipients.map((r) => r.partyId)).toEqual(["p-1", "p-1"]);
    });

    it("rechaza una factura en cualquier estado distinto de autorizada", () => {
      for (const state of [
        "RESERVED",
        "SIGNED",
        "SEND_UNKNOWN",
        "RECEIVED",
        "RETURNED",
        "NOT_AUTHORIZED",
        "MANUAL_REVIEW",
      ]) {
        const invoices = new Map([["inv-1", invoice({ state, authorization: null })]]);
        expect(codes(evaluate({}, { invoices })), state).toContainEqual([
          "SHIPPING_GUIDE_INVOICE_NOT_AUTHORIZED",
          1,
          null,
        ]);
      }
    });

    it("rechaza una factura sin autorizar, de otro ambiente, alterada, inexistente o de otro tipo", () => {
      for (const [changes, code] of [
        [{ state: "SIGNED", authorization: null }, "SHIPPING_GUIDE_INVOICE_NOT_AUTHORIZED"],
        [{ environment: "PRODUCTION" }, "SHIPPING_GUIDE_INVOICE_ENVIRONMENT_MISMATCH"],
        [{ intact: false }, "SHIPPING_GUIDE_INVOICE_NOT_INTACT"],
        [{ documentType: "04" }, "SHIPPING_GUIDE_INVOICE_NOT_FOUND"],
      ] as const) {
        const invoices = new Map([["inv-1", invoice(changes)]]);
        expect(codes(evaluate({}, { invoices }))).toContainEqual([code, 1, null]);
      }
      expect(codes(evaluate({}, { invoices: new Map() }))).toContainEqual([
        "SHIPPING_GUIDE_INVOICE_NOT_FOUND",
        1,
        null,
      ]);
      expect(codes(evaluate({ recipients: [{ ...recipient, support: null }] }))).toContainEqual([
        "SHIPPING_GUIDE_SUPPORT_REQUIRED",
        1,
        null,
      ]);
    });

    it("acepta una factura a consumidor final con un destinatario identificado distinto del comprador", () => {
      // La factura no guarda aquí su comprador: el destinatario es el tercero elegido, nunca el
      // consumidor final (política del MVP).
      const result = evaluate();
      expect(result.issues).toEqual([]);
      expect(result.guide?.recipients[0]?.identification).toBe("1790012345001");
    });
  });

  describe("detalle", () => {
    it("un producto de tipo bien lleva su código principal y su código auxiliar", () => {
      const result = evaluate({
        recipients: [
          {
            ...recipient,
            details: [
              {
                productId: "aux-1",
                mainCode: null,
                auxiliaryCode: null,
                description: "Varilla",
                quantity: "1",
              },
            ],
          },
        ],
      });
      expect(result.issues).toEqual([]);
      expect(
        result.guide?.recipients[0]?.details.map((d) => [d.mainCode, d.auxiliaryCode]),
      ).toEqual([["VAR-12", "AUX-12"]]);
    });

    it("congela los códigos y el nombre de un producto de tipo bien y admite líneas libres", () => {
      const result = evaluate({
        recipients: [
          {
            ...recipient,
            details: [
              {
                productId: "prod-1",
                mainCode: null,
                auxiliaryCode: null,
                description: "Cemento 50 kg en sacos",
                quantity: "2.500",
              },
              { ...detail, mainCode: " LIB-1 ", quantity: "10.254632" },
            ],
          },
        ],
      });
      expect(result.issues).toEqual([]);
      expect(result.guide?.recipients[0]?.details).toEqual([
        {
          position: 1,
          productId: "prod-1",
          productName: "Cemento 50 kg",
          mainCode: "CEM-50",
          auxiliaryCode: null,
          description: "Cemento 50 kg en sacos",
          quantity: "2.5",
        },
        {
          position: 2,
          productId: null,
          productName: null,
          mainCode: "LIB-1",
          auxiliaryCode: null,
          description: "10 cajas de 12 botellas de 1 litro",
          quantity: "10.254632",
        },
      ]);
    });

    it("rechaza un servicio, un producto inactivo o inexistente, sin detalle, sin descripción y cantidades fuera del dominio", () => {
      const with_ = (details: unknown[]) =>
        codes(evaluate({ recipients: [{ ...recipient, details: details as never }] }));
      expect(with_([{ ...detail, productId: "svc-1" }])).toContainEqual([
        "SHIPPING_GUIDE_PRODUCT_NOT_GOOD",
        1,
        1,
      ]);
      expect(with_([{ ...detail, productId: "old-1" }])).toContainEqual([
        "SHIPPING_GUIDE_PRODUCT_INACTIVE",
        1,
        1,
      ]);
      expect(with_([{ ...detail, productId: "nada" }])).toContainEqual([
        "SHIPPING_GUIDE_PRODUCT_NOT_FOUND",
        1,
        1,
      ]);
      expect(with_([])).toContainEqual(["SHIPPING_GUIDE_DETAILS_REQUIRED", 1, null]);
      expect(with_([{ ...detail, description: " " }])).toContainEqual([
        "SHIPPING_GUIDE_DESCRIPTION_INVALID",
        1,
        1,
      ]);
      for (const quantity of [null, "0", "-1", "1.1234567"]) {
        expect(with_([detail, { ...detail, quantity }])).toContainEqual([
          "SHIPPING_GUIDE_QUANTITY_INVALID",
          1,
          2,
        ]);
      }
    });
  });

  describe("límites de recursos compuestos", () => {
    const many = (recipients: number, details: number) =>
      Array.from({ length: recipients }, () => ({
        ...recipient,
        details: Array.from({ length: details }, () => detail),
      }));

    it("el global de detalles rige aunque los individuales permitan más", () => {
      const result = evaluate({ recipients: many(10, 20) });
      expect(codes(result)).toEqual([["SHIPPING_GUIDE_RESOURCE_LIMIT", "recipients", null]]);
      expect(result.issues[0]?.message).toContain("no un límite del SRI");
    });

    it("rechaza demasiados destinatarios o detalles por destinatario y aplica los límites configurados", () => {
      expect(codes(evaluate({ recipients: many(11, 1) }))).toContainEqual([
        "SHIPPING_GUIDE_RESOURCE_LIMIT",
        "recipients",
        null,
      ]);
      expect(codes(evaluate({ recipients: many(1, 51) }))).toContainEqual([
        "SHIPPING_GUIDE_RESOURCE_LIMIT",
        1,
        null,
      ]);
      expect(
        evaluate(
          { recipients: many(2, 2) },
          { limits: { recipients: 50, detailsPerRecipient: 100, details: 3 } },
        ).issues.map((issue) => issue.code),
      ).toEqual(["SHIPPING_GUIDE_RESOURCE_LIMIT"]);
    });
  });
});

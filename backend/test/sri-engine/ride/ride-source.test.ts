// Lector del XML de origen del RIDE (add-document-archive, design D3): solo la factura 1.1.0 que el
// sistema emite, con sus textos e importes exactos; rechaza un XML peligroso, otro documento, todo
// elemento que el builder no escribe y unos datos de autorización que no corresponden.
import { beforeAll, describe, expect, inject, it } from "vitest";
import {
  RideRejectedError,
  type RideSourceInput,
} from "../../../src/modules/sri-engine/application/ride.ts";
import { readRideSource } from "../../../src/modules/sri-engine/infrastructure/ride/ride-source.ts";
import {
  INVOICE_CASES,
  PAYMENT_LABELS,
  authorizedInvoice,
  type AuthorizedInvoice,
} from "../../support/ride-invoices.ts";

const p12Dir = inject("p12FixturesDir");
let complete: AuthorizedInvoice;
let largeValues: AuthorizedInvoice;

const rejection = (input: RideSourceInput) => {
  try {
    readRideSource(input);
  } catch (error) {
    if (error instanceof RideRejectedError) return { code: error.code, detail: error.detail };
    throw error;
  }
  return null;
};
/** El mismo XML con un cambio de texto (el lector no verifica la firma; el job ya lo hizo). */
const edited = (invoice: AuthorizedInvoice, edit: (xml: string) => string): RideSourceInput => {
  const xml = edit(invoice.xml.toString("utf8"));
  if (xml === invoice.xml.toString("utf8")) throw new Error("la edición no cambió el XML");
  return { ...invoice.input, xml: Buffer.from(xml, "utf8") };
};

beforeAll(async () => {
  complete = await authorizedInvoice(INVOICE_CASES.complete, p12Dir);
  largeValues = await authorizedInvoice(INVOICE_CASES.largeValues, p12Dir);
});

describe("lectura de la factura 1.1.0 del sistema", () => {
  it("lee el emisor, el comprador, las líneas, los impuestos y los pagos tal como están", () => {
    const ride = readRideSource(complete.input);
    const { snapshot } = complete;
    expect(ride).toMatchObject({
      environment: "2",
      emissionType: "1",
      legalName: snapshot.issuer.legalName,
      tradeName: snapshot.issuer.tradeName,
      ruc: snapshot.issuer.ruc,
      accessKey: snapshot.accessKey,
      establishment: "001",
      emissionPoint: "001",
      sequential: "000000315",
      specialTaxpayer: "13216",
      accountingRequired: "SI",
      withholdingAgentResolution: "1",
      rimpeLegend: "CONTRIBUYENTE RÉGIMEN RIMPE",
      issueDate: "04/10/2026",
      buyer: snapshot.buyer,
      totals: {
        withoutTaxes: snapshot.totals.withoutTaxes,
        discount: snapshot.totals.discount,
        total: snapshot.totals.total,
      },
      authorization: complete.input.authorization,
    });
    expect(ride.lines).toEqual(
      snapshot.lines.map((line) => ({
        mainCode: line.mainCode,
        auxiliaryCode: line.auxiliaryCode,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        total: line.taxableBase,
      })),
    );
    expect(ride.totals.taxes).toEqual(
      snapshot.totals.taxes.map((tax) => ({
        rateCode: tax.rateCode,
        rate: snapshot.lines.find((line) => line.taxes[0]!.rateCode === tax.rateCode)!.taxes[0]!
          .rate,
        base: tax.base,
        amount: tax.amount,
      })),
    );
    expect(ride.payments).toEqual(
      snapshot.payments.map((payment) => ({
        method: payment.method,
        label: PAYMENT_LABELS[payment.method],
        total: payment.total,
      })),
    );
  });

  it("conserva los importes exactos, sin convertirlos a número", () => {
    const [lineRead] = readRideSource(largeValues.input).lines;
    expect(lineRead).toMatchObject({ quantity: "999999.999999", unitPrice: "1.000001" });
  });
});

describe("rechazos de seguridad (RIDE_SOURCE_INVALID)", () => {
  it.each([
    [
      "DTD",
      (xml: string) => xml.replace("<factura", '<!DOCTYPE factura [<!ENTITY x "y">]><factura'),
    ],
    [
      "DTD",
      (xml: string) => xml.replace("<factura", '<!ENTITY x SYSTEM "file:///etc/passwd"><factura'),
    ],
    ["MALFORMED", (xml: string) => xml.replace("</infoTributaria>", "")],
    [
      "TOO_DEEP",
      (xml: string) =>
        xml.replace("<razonSocial>", `<razonSocial>${"<a>".repeat(25)}x${"</a>".repeat(25)}`),
    ],
  ])("%s", (detail, edit) => {
    expect(rejection(edited(complete, edit))).toEqual({
      code: "RIDE_SOURCE_INVALID",
      detail: [detail],
    });
  });

  it("un XML de más de 2 MiB o que no es UTF-8", () => {
    const huge = Buffer.concat([complete.xml, Buffer.alloc(2 * 1024 * 1024, 0x20)]);
    expect(rejection({ ...complete.input, xml: huge })).toEqual({
      code: "RIDE_SOURCE_INVALID",
      detail: ["TOO_LARGE"],
    });
    const latin1 = Buffer.from(complete.xml.toString("utf8"), "latin1");
    expect(rejection({ ...complete.input, xml: latin1 })).toEqual({
      code: "RIDE_SOURCE_INVALID",
      detail: ["NOT_UTF8"],
    });
  });

  it("una factura 1.0.0 u otro comprobante", () => {
    expect(
      rejection(edited(complete, (xml) => xml.replace('version="1.1.0"', 'version="1.0.0"'))),
    ).toEqual({ code: "RIDE_SOURCE_INVALID", detail: ["UNSUPPORTED_VERSION"] });
    expect(
      rejection(
        edited(complete, (xml) => xml.replace("<codDoc>01</codDoc>", "<codDoc>04</codDoc>")),
      ),
    ).toEqual({ code: "RIDE_SOURCE_INVALID", detail: ["NOT_INVOICE"] });
    expect(
      rejection(
        edited(complete, (xml) =>
          xml.replace("<factura ", "<notaCredito ").replace("</factura>", "</notaCredito>"),
        ),
      ),
    ).toEqual({ code: "RIDE_SOURCE_INVALID", detail: ["NOT_INVOICE"] });
  });
});

describe("contenido que el sistema no emite (RIDE_SOURCE_UNSUPPORTED)", () => {
  it.each([
    [
      "propina",
      (xml: string) => xml.replace("<importeTotal>", "<propina>1.00</propina><importeTotal>"),
      ["factura.infoFactura.propina"],
    ],
    [
      "información adicional",
      (xml: string) =>
        xml.replace(
          "</detalles>",
          '</detalles><infoAdicional><campoAdicional nombre="Email">a@b.ec</campoAdicional></infoAdicional>',
        ),
      ["factura.infoAdicional"],
    ],
    [
      "guía de remisión",
      (xml: string) =>
        xml.replace(
          "<obligadoContabilidad>",
          "<guiaRemision>001-001-000000001</guiaRemision><obligadoContabilidad>",
        ),
      ["factura.infoFactura.guiaRemision"],
    ],
    [
      "detalle adicional",
      (xml: string) =>
        xml.replace(
          "<impuestos>",
          '<detallesAdicionales><detAdicional nombre="Color" valor="Rojo"/></detallesAdicionales><impuestos>',
        ),
      ["factura.detalles.detalle.detallesAdicionales"],
    ],
    [
      "plazo de pago",
      (xml: string) => xml.replace(/<\/total>(\s*)<\/pago>/, "</total>$1<plazo>30</plazo></pago>"),
      ["factura.infoFactura.pagos.pago.plazo"],
    ],
    [
      "ICE",
      (xml: string) => xml.replace("<codigo>2</codigo>", "<codigo>3</codigo>"),
      ["impuesto.codigo:3"],
    ],
    [
      "IRBPNR",
      (xml: string) => xml.replace("<codigo>2</codigo>", "<codigo>5</codigo>"),
      ["impuesto.codigo:5"],
    ],
  ])("%s", (_name, edit, detail) => {
    expect(rejection(edited(complete, edit))).toEqual({ code: "RIDE_SOURCE_UNSUPPORTED", detail });
  });
});

describe("datos de autorización que no corresponden (RIDE_AUTHORIZATION_MISMATCH)", () => {
  const otherKey = (key: string) => `${key.slice(0, 48)}${key.endsWith("1") ? "2" : "1"}`;

  it("la clave del comprobante guardado, el número de autorización o el ambiente", () => {
    const { input } = complete;
    expect(rejection({ ...input, accessKey: otherKey(input.accessKey) })).toEqual({
      code: "RIDE_AUTHORIZATION_MISMATCH",
      detail: ["claveAcceso"],
    });
    expect(
      rejection({
        ...input,
        authorization: { ...input.authorization, number: otherKey(input.accessKey) },
      }),
    ).toEqual({ code: "RIDE_AUTHORIZATION_MISMATCH", detail: ["numeroAutorizacion"] });
    expect(
      rejection({ ...input, authorization: { ...input.authorization, environment: "TEST" } }),
    ).toEqual({ code: "RIDE_AUTHORIZATION_MISMATCH", detail: ["ambiente"] });
  });
});

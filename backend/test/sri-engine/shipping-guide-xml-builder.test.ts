// Builder propio de la guía de remisión 1.1.0 (add-shipping-guides, tarea 5.1, design D16): función
// pura de su snapshot, sin `number`, en el orden del XSD `GuiaRemision_V1.1.0`, con el texto escapado,
// los cuatro datos del sustento solo con factura y sin los elementos que el sistema no escribe.
// Golden fixtures de bytes exactos, cada uno validado contra el XSD oficial registrado. Para
// regenerarlos a propósito: `SHIPPING_GUIDE_XML_UPDATE=1`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ShippingGuideXmlError,
  type ShippingGuideXmlSnapshot,
} from "../../src/modules/sri-engine/application/ports.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createShippingGuideXmlBuilder } from "../../src/modules/sri-engine/infrastructure/shipping-guide-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const FIXTURES = path("../fixtures/shipping-guide-xml/");
const UPDATE = process.env.SHIPPING_GUIDE_XML_UPDATE === "1";
const registry = (
  JSON.parse(
    readFileSync(path("../../src/modules/catalogs/datasets/schema-registry/2.json"), "utf8"),
  ) as {
    entries: (Omit<SchemaRegistryEntry, "documentType" | "version"> & {
      documentType?: string;
      version?: string;
    })[];
  }
).entries.map((entry) => ({
  ...entry,
  documentType: entry.documentType ?? null,
  version: entry.version ?? null,
  imports: entry.imports ?? [],
}));
const guiaRemision = registeredSchema(registry, "06", "1.1.0")!;
const xsd = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const builder = createShippingGuideXmlBuilder();

type Recipient = ShippingGuideXmlSnapshot["recipients"][number];

const INVOICE_SUPPORT = {
  documentType: "01",
  documentNumber: "001-001-000000123",
  authorizationNumber: "0510202601179001234500110010010000001231234567815",
  issueDate: "2026-10-05",
};

const RECIPIENT: Recipient = {
  identification: "1790012345001",
  legalName: "COMERCIAL ANDINA S.A.",
  address: "Av. Simón Bolívar S/N Intercambiador",
  motive: "Venta de maquinaria",
  destinationEstablishmentCode: null,
  route: null,
  support: INVOICE_SUPPORT,
  details: [
    {
      mainCode: "CEM-50",
      auxiliaryCode: null,
      description: "Cemento 50 kg en sacos",
      quantity: "10",
    },
  ],
};

const BASE: ShippingGuideXmlSnapshot = {
  schemaVersion: "1.1.0",
  environment: "1",
  accessKey: "0610202606179001234500110010010000000011234567811",
  sequential: "000000001",
  issuer: {
    ruc: "1790012345001",
    legalName: "DISTRIBUIDORA NACIONAL S.A.",
    tradeName: null,
    headOfficeAddress: "Av. Amazonas N24-03, Quito",
    establishment: "001",
    emissionPoint: "001",
    establishmentAddress: "Av. 6 de Diciembre N33-55, Quito",
    specialTaxpayerNumber: null,
    accountingRequired: true,
    withholdingAgentResolution: null,
    rimpe: false,
  },
  departureAddress: "Av. Eloy Alfaro 34 y Av. Libertad",
  carrier: {
    identificationType: "04",
    identification: "1790012345001",
    legalName: "DISTRIBUIDORA NACIONAL S.A.",
  },
  transportStart: "2026-10-06",
  transportEnd: "2026-10-07",
  plate: "PAA-1234",
  recipients: [RECIPIENT],
};

const CASES: Record<string, ShippingGuideXmlSnapshot> = {
  // Transporte propio, un destinatario con su factura.
  "self-transport-invoice.xml": BASE,
  // Tercero transportista con cédula; un destinatario con factura y dos con excepciones declaradas
  // (sin sustento en el XML), con ruta y código de destino declarado de un tercero.
  "party-carrier-exceptions.xml": {
    ...BASE,
    sequential: "000000002",
    accessKey: "0610202606179001234500110010010000000021234567818",
    carrier: { identificationType: "05", identification: "1712345678", legalName: "Juan Torres" },
    recipients: [
      RECIPIENT,
      {
        ...RECIPIENT,
        identification: "0102030405",
        legalName: "María Pérez",
        motive: "Consignación",
        support: null,
        route: "Quito - Cayambe - Otavalo",
        destinationEstablishmentCode: "003",
      },
      {
        ...RECIPIENT,
        identification: "P12345678",
        legalName: "Feria Industrial del Norte",
        motive: "Exhibición",
        support: null,
      },
    ],
  },
  // Traslado a otro establecimiento propio: la empresa como destinataria, partida del origen y el
  // código del establecimiento de destino.
  "own-establishment.xml": {
    ...BASE,
    sequential: "000000003",
    accessKey: "0610202606179001234500110010010000000031234567814",
    departureAddress: "Av. 6 de Diciembre N33-55, Quito",
    recipients: [
      {
        identification: "1790012345001",
        legalName: "DISTRIBUIDORA NACIONAL S.A.",
        address: "Av. 10 de Agosto y Colón, Quito",
        motive: "Reposición de stock",
        destinationEstablishmentCode: "002",
        route: null,
        support: null,
        details: [
          { mainCode: null, auxiliaryCode: null, description: "Varilla 12 mm", quantity: "250" },
        ],
      },
    ],
  },
  // Producto con código auxiliar, línea libre sin códigos, 6 decimales y forma canónica.
  "products-and-free-lines.xml": {
    ...BASE,
    sequential: "000000004",
    accessKey: "0610202606179001234500110010010000000041234567810",
    recipients: [
      {
        ...RECIPIENT,
        details: [
          {
            mainCode: "CEM-50",
            auxiliaryCode: "7861234567890",
            description: "Cemento 50 kg",
            quantity: "10.254632",
          },
          {
            mainCode: null,
            auxiliaryCode: null,
            description: "10 cajas de 12 botellas de 1 litro",
            quantity: "2.5",
          },
          {
            mainCode: "LIB-1",
            auxiliaryCode: null,
            description: "Herramientas varias",
            quantity: "999999999999.999999",
          },
        ],
      },
    ],
  },
  // Caracteres especiales; emisor con nombre comercial, contribuyente especial y RIMPE; Producción.
  "special-characters.xml": {
    ...BASE,
    environment: "2",
    sequential: "000000005",
    accessKey: "0610202606179001234500220010010000000051234567815",
    issuer: {
      ...BASE.issuer,
      tradeName: 'Ferretería "La Ñusta" & Cía.',
      specialTaxpayerNumber: "12345",
      rimpe: true,
      accountingRequired: false,
    },
    departureAddress: "Bodega <norte> & patio 'B'",
    recipients: [
      {
        ...RECIPIENT,
        legalName: "Peña & Asociados <Construcciones> 'Ñandú'",
        motive: 'Venta "especial" & entrega',
        details: [
          { mainCode: null, auxiliaryCode: null, description: 'Tubería ½" & codos', quantity: "3" },
        ],
      },
    ],
  },
  // Longitudes máximas de los textos: 300, 20, 13, 25 y 3.
  "maximum-lengths.xml": {
    ...BASE,
    sequential: "000000006",
    accessKey: "0610202606179001234500110010010000000061234567812",
    departureAddress: "P".repeat(300),
    carrier: {
      identificationType: "06",
      identification: "A".repeat(13),
      legalName: "T".repeat(300),
    },
    plate: "Z".repeat(20),
    recipients: [
      {
        identification: "I".repeat(20),
        legalName: "R".repeat(300),
        address: "D".repeat(300),
        motive: "M".repeat(300),
        destinationEstablishmentCode: "999",
        route: "U".repeat(300),
        support: INVOICE_SUPPORT,
        details: [
          {
            mainCode: "C".repeat(25),
            auxiliaryCode: "X".repeat(25),
            description: "E".repeat(300),
            quantity: "1",
          },
        ],
      },
    ],
  },
};

const compact = (xml: string) => xml.replace(/>\s+</g, "><");

/** Compara con el golden, o lo escribe cuando se regenera a propósito. */
function matchesGolden(name: string, actual: string) {
  const file = `${FIXTURES}${name}`;
  if (UPDATE || !existsSync(file)) {
    expect(UPDATE, `falta el golden ${name}: generarlo con SHIPPING_GUIDE_XML_UPDATE=1`).toBe(true);
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

const codeOf = (snapshot: ShippingGuideXmlSnapshot) => {
  try {
    builder.build(snapshot);
    return null;
  } catch (error) {
    return error instanceof ShippingGuideXmlError ? error.code : String(error);
  }
};

describe("builder de la guía de remisión 1.1.0", () => {
  for (const [name, snapshot] of Object.entries(CASES)) {
    it(`${name}: bytes exactos y válido contra GuiaRemision_V1.1.0.xsd`, async () => {
      const xml = builder.build(snapshot);
      matchesGolden(name, xml);
      expect(await xsd.validate(xml, guiaRemision)).toEqual({ valid: true });
    });
  }

  it("escribe la cabecera, el transporte y el destinatario con su factura en el orden del XSD", () => {
    const xml = compact(builder.build(BASE));
    expect(xml).toContain('<guiaRemision id="comprobante" version="1.1.0">');
    expect(xml).toContain("<codDoc>06</codDoc>");
    expect(xml).toContain(
      "<infoGuiaRemision><dirEstablecimiento>Av. 6 de Diciembre N33-55, Quito</dirEstablecimiento><dirPartida>Av. Eloy Alfaro 34 y Av. Libertad</dirPartida><razonSocialTransportista>DISTRIBUIDORA NACIONAL S.A.</razonSocialTransportista><tipoIdentificacionTransportista>04</tipoIdentificacionTransportista><rucTransportista>1790012345001</rucTransportista><obligadoContabilidad>SI</obligadoContabilidad><fechaIniTransporte>06/10/2026</fechaIniTransporte><fechaFinTransporte>07/10/2026</fechaFinTransporte><placa>PAA-1234</placa></infoGuiaRemision>",
    );
    expect(xml).toContain(
      "<destinatarios><destinatario><identificacionDestinatario>1790012345001</identificacionDestinatario><razonSocialDestinatario>COMERCIAL ANDINA S.A.</razonSocialDestinatario><dirDestinatario>Av. Simón Bolívar S/N Intercambiador</dirDestinatario><motivoTraslado>Venta de maquinaria</motivoTraslado><codDocSustento>01</codDocSustento><numDocSustento>001-001-000000123</numDocSustento><numAutDocSustento>0510202601179001234500110010010000001231234567815</numAutDocSustento><fechaEmisionDocSustento>05/10/2026</fechaEmisionDocSustento><detalles><detalle><codigoInterno>CEM-50</codigoInterno><descripcion>Cemento 50 kg en sacos</descripcion><cantidad>10</cantidad></detalle></detalles></destinatario></destinatarios>",
    );
  });

  it("solo escribe el sustento con factura: una excepción no tiene campo en el XML", () => {
    const xml = compact(builder.build(CASES["party-carrier-exceptions.xml"]!));
    const recipients = xml.split("<destinatario>").slice(1);
    expect(recipients.map((r) => r.includes("<codDocSustento>"))).toEqual([true, false, false]);
    expect(recipients[1]).toContain(
      "<codEstabDestino>003</codEstabDestino><ruta>Quito - Cayambe - Otavalo</ruta>",
    );
    expect(xml).toContain(
      "<tipoIdentificacionTransportista>05</tipoIdentificacionTransportista><rucTransportista>1712345678</rucTransportista>",
    );
  });

  it("escribe las cantidades tal como vienen, sin redondear ni convertir", () => {
    const xml = builder.build(CASES["products-and-free-lines.xml"]!);
    expect(xml).toContain("<cantidad>10.254632</cantidad>");
    expect(xml).toContain("<cantidad>2.5</cantidad>");
    expect(xml).toContain("<cantidad>999999999999.999999</cantidad>");
    expect(compact(xml)).toContain(
      "<detalle><descripcion>10 cajas de 12 botellas de 1 litro</descripcion><cantidad>2.5</cantidad></detalle>",
    );
  });

  it("nunca escribe los elementos que el sistema no emite ni nodos vacíos", () => {
    for (const snapshot of Object.values(CASES)) {
      const xml = builder.build(snapshot);
      for (const absent of [
        "<rise>",
        "<docAduaneroUnico>",
        "<detallesAdicionales>",
        "<maquinaFiscal>",
        "<infoAdicional>",
        "<precioUnitario>",
        "<totalSinImpuestos>",
        "<impuestos>",
      ]) {
        expect(xml).not.toContain(absent);
      }
      expect(xml).not.toMatch(/<(\w+)><\/\1>|<\w+\/>/);
    }
  });

  it("rechaza otra versión del esquema, una cantidad que no es decimal y textos fuera del XSD", () => {
    expect(codeOf({ ...BASE, schemaVersion: "1.0.0" })).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(
      codeOf({
        ...BASE,
        recipients: [{ ...RECIPIENT, details: [{ ...RECIPIENT.details[0]!, quantity: "10,5" }] }],
      }),
    ).toBe("INVALID_SNAPSHOT_AMOUNT");
    for (const snapshot of [
      { ...BASE, plate: "P".repeat(21) },
      { ...BASE, carrier: { ...BASE.carrier, identification: "A".repeat(14) } },
      { ...BASE, carrier: { ...BASE.carrier, identificationType: "08" } },
      { ...BASE, recipients: [{ ...RECIPIENT, destinationEstablishmentCode: "1A" }] },
      {
        ...BASE,
        recipients: [
          { ...RECIPIENT, support: { ...INVOICE_SUPPORT, documentNumber: "001001000000123" } },
        ],
      },
      { ...BASE, recipients: [] },
    ]) {
      expect(codeOf(snapshot)).toBe("INVALID_SNAPSHOT_TEXT");
    }
  });

  it("es determinista: el mismo snapshot da los mismos bytes", () => {
    expect(builder.build(BASE)).toBe(builder.build(structuredClone(BASE)));
  });
});

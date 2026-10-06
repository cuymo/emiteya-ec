// Builder propio del comprobante de retención 2.0.0 (add-withholding-receipts, tarea 5.1, design D10 y
// D17): función pura de su snapshot, sin `number`, en el orden del XSD `ComprobanteRetencion_V2.0.0`,
// con el texto escapado, `codDocSustento` como código de dos caracteres, `pagoLocExt` 01 y sin los
// elementos que el sistema no escribe. Golden fixtures de bytes exactos, cada uno validado contra el
// XSD oficial registrado. Para regenerarlos a propósito: `WITHHOLDING_XML_UPDATE=1`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WithholdingReceiptXmlError,
  type WithholdingReceiptXmlSnapshot,
} from "../../src/modules/sri-engine/application/ports.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createWithholdingReceiptXmlBuilder } from "../../src/modules/sri-engine/infrastructure/withholding-receipt-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const FIXTURES = path("../fixtures/withholding-receipt-xml/");
const UPDATE = process.env.WITHHOLDING_XML_UPDATE === "1";
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
const comprobanteRetencion = registeredSchema(registry, "07", "2.0.0")!;
const xsd = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const builder = createWithholdingReceiptXmlBuilder();

type Support = WithholdingReceiptXmlSnapshot["supports"][number];
const iva = (rateCode: string, tariff: string, base: string, amount: string) => ({
  taxCode: "2",
  rateCode,
  base,
  tariff,
  amount,
});
const income = (code: string, base: string, percentage: string, amount: string) => ({
  taxCode: "1",
  code,
  base,
  percentage,
  amount,
});
const ivaWithholding = (code: string, base: string, percentage: string, amount: string) => ({
  taxCode: "2",
  code,
  base,
  percentage,
  amount,
});

const SUPPORT: Support = {
  supportCode: "01",
  documentType: "01",
  number: "001001000000123",
  issueDate: "2026-10-01",
  authorizationNumber: "0110202601179123456700110010010000001231234567815",
  totalWithoutTaxes: "100.29",
  importTotal: "115.33",
  taxes: [iva("4", "15", "100.29", "15.04")],
  withholdings: [income("312C", "100.29", "1.75", "1.76")],
  payments: [{ method: "20", total: "115.33" }],
};

const BASE: WithholdingReceiptXmlSnapshot = {
  schemaVersion: "2.0.0",
  environment: "1",
  issueDate: "2026-10-06",
  accessKey: "0610202607179001234500110010010000000011234567811",
  sequential: "000000001",
  issuer: {
    ruc: "1790012345001",
    legalName: "COMERCIAL ANDINA S.A.",
    tradeName: null,
    headOfficeAddress: "Av. Amazonas N24-03, Quito",
    establishment: "001",
    emissionPoint: "001",
    establishmentAddress: "Av. 6 de Diciembre N33-55, Quito",
    specialTaxpayerNumber: null,
    accountingRequired: true,
    withholdingAgentResolution: "1",
    rimpe: false,
  },
  subject: {
    identificationType: "04",
    identification: "1791234567001",
    legalName: "PROVEEDORA DEL SUR S.A.",
  },
  relatedParty: "NO",
  fiscalPeriod: "10/2026",
  supports: [SUPPORT],
};

const CASES: Record<string, WithholdingReceiptXmlSnapshot> = {
  // Un documento con una retención de renta (312C al 1.75 %).
  "one-income.xml": BASE,
  // Renta e IVA sobre el mismo documento.
  "income-and-iva.xml": {
    ...BASE,
    sequential: "000000002",
    accessKey: "0610202607179001234500110010010000000021234567818",
    supports: [
      {
        ...SUPPORT,
        withholdings: [
          income("312C", "100.29", "1.75", "1.76"),
          ivaWithholding("1", "15.04", "30", "4.51"),
        ],
      },
    ],
  },
  // Factura, nota de venta y liquidación de compra con varias retenciones anidadas, con y sin
  // autorización (49, 10 y ninguna) y con varias formas de pago.
  "multiple-supports.xml": {
    ...BASE,
    sequential: "000000003",
    accessKey: "0610202607179001234500110010010000000031234567814",
    relatedParty: "SI",
    fiscalPeriod: "09/2026",
    supports: [
      {
        ...SUPPORT,
        withholdings: [
          income("303", "1000.00", "10", "100.00"),
          ivaWithholding("3", "150.00", "100", "150.00"),
        ],
      },
      {
        supportCode: "02",
        documentType: "02",
        number: "002001000000045",
        issueDate: "2026-09-15",
        authorizationNumber: "1122334455",
        totalWithoutTaxes: "200.00",
        importTotal: "200.00",
        taxes: [iva("0", "0", "200.00", "0.00")],
        withholdings: [income("343", "200.00", "1", "2.00")],
        payments: [
          { method: "01", total: "50.00" },
          { method: "20", total: "150.00" },
        ],
      },
      {
        supportCode: "07",
        documentType: "03",
        number: "001002000000007",
        issueDate: "2026-09-30",
        authorizationNumber: null,
        totalWithoutTaxes: "80.00",
        importTotal: "92.00",
        taxes: [iva("4", "15", "80.00", "12.00")],
        withholdings: [
          income("311", "80.00", "3", "2.40"),
          ivaWithholding("2", "12.00", "70", "8.40"),
          ivaWithholding("11", "12.00", "50", "6.00"),
        ],
        payments: [{ method: "01", total: "92.00" }],
      },
    ],
  },
  // Retención en cero: el código 7 explícito con su valor 0.00.
  "zero-rate.xml": {
    ...BASE,
    sequential: "000000004",
    accessKey: "0610202607179001234500110010010000000041234567810",
    supports: [
      {
        ...SUPPORT,
        withholdings: [
          income("312C", "100.29", "1.75", "1.76"),
          ivaWithholding("7", "15.04", "0", "0.00"),
        ],
      },
    ],
  },
  // Impuestos declarados del documento: solo IVA, IVA e ICE, IRBPNR y varias entradas tributarias.
  "support-taxes.xml": {
    ...BASE,
    sequential: "000000005",
    accessKey: "0610202607179001234500110010010000000051234567815",
    supports: [
      { ...SUPPORT, number: "001001000000201" },
      {
        ...SUPPORT,
        number: "001001000000202",
        totalWithoutTaxes: "100.00",
        importTotal: "295.00",
        taxes: [
          iva("4", "15", "250.00", "37.50"),
          { taxCode: "3", rateCode: "3011", base: "100.00", tariff: "150", amount: "150.00" },
        ],
        withholdings: [income("312", "100.00", "2", "2.00")],
        payments: [{ method: "20", total: "295.00" }],
      },
      {
        ...SUPPORT,
        number: "001001000000203",
        totalWithoutTaxes: "10.00",
        importTotal: "11.52",
        taxes: [
          iva("4", "15", "10.00", "1.50"),
          { taxCode: "5", rateCode: "5001", base: "1.00", tariff: "0.02", amount: "0.02" },
        ],
        withholdings: [income("312", "10.00", "2", "0.20")],
        payments: [{ method: "01", total: "11.52" }],
      },
      {
        ...SUPPORT,
        number: "001001000000204",
        totalWithoutTaxes: "300.00",
        importTotal: "315.00",
        taxes: [
          iva("4", "15", "100.00", "15.00"),
          iva("0", "0", "100.00", "0.00"),
          iva("6", "0", "50.00", "0.00"),
          iva("7", "0", "50.00", "0.00"),
        ],
        withholdings: [income("312", "300.00", "2", "6.00")],
        payments: [{ method: "20", total: "315.00" }],
      },
    ],
  },
  // Sujeto con caracteres especiales; emisor con nombre comercial, contribuyente especial y RIMPE;
  // ambiente de producción.
  "special-characters.xml": {
    ...BASE,
    environment: "2",
    sequential: "000000006",
    accessKey: "0610202607179001234500220010010000000061234567812",
    issuer: {
      ...BASE.issuer,
      tradeName: 'Ferretería "La Ñusta" & Cía.',
      specialTaxpayerNumber: "12345",
      rimpe: true,
      accountingRequired: false,
    },
    subject: {
      identificationType: "05",
      identification: "1710034065",
      legalName: "Peña & Asociados <Construcciones> 'Ñandú'",
    },
  },
};

/** El XML sin la sangría entre etiquetas, para buscar secuencias de elementos. */
const compact = (xml: string) => xml.replace(/>\s+</g, "><");

/** Compara con el golden, o lo escribe cuando se regenera a propósito. */
function matchesGolden(name: string, actual: string) {
  const file = `${FIXTURES}${name}`;
  if (UPDATE || !existsSync(file)) {
    expect(UPDATE, `falta el golden ${name}: generarlo con WITHHOLDING_XML_UPDATE=1`).toBe(true);
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

describe("builder del comprobante de retención 2.0.0", () => {
  for (const [name, snapshot] of Object.entries(CASES)) {
    it(`${name}: bytes exactos y válido contra ComprobanteRetencion_V2.0.0.xsd`, async () => {
      const xml = builder.build(snapshot);
      matchesGolden(name, xml);
      expect(await xsd.validate(xml, comprobanteRetencion)).toEqual({ valid: true });
    });
  }

  it("transcribe el sujeto, la parte relacionada, el período, el documento y la retención", () => {
    const xml = compact(builder.build(BASE));
    expect(xml).toContain('<comprobanteRetencion id="comprobante" version="2.0.0">');
    expect(xml).toContain("<codDoc>07</codDoc>");
    expect(xml).toContain("<agenteRetencion>1</agenteRetencion>");
    expect(xml).toContain(
      "<infoCompRetencion><fechaEmision>06/10/2026</fechaEmision><dirEstablecimiento>Av. 6 de Diciembre N33-55, Quito</dirEstablecimiento><obligadoContabilidad>SI</obligadoContabilidad><tipoIdentificacionSujetoRetenido>04</tipoIdentificacionSujetoRetenido><parteRel>NO</parteRel><razonSocialSujetoRetenido>PROVEEDORA DEL SUR S.A.</razonSocialSujetoRetenido><identificacionSujetoRetenido>1791234567001</identificacionSujetoRetenido><periodoFiscal>10/2026</periodoFiscal></infoCompRetencion>",
    );
    expect(xml).toContain(
      "<docSustento><codSustento>01</codSustento><codDocSustento>01</codDocSustento><numDocSustento>001001000000123</numDocSustento><fechaEmisionDocSustento>01/10/2026</fechaEmisionDocSustento><numAutDocSustento>0110202601179123456700110010010000001231234567815</numAutDocSustento><pagoLocExt>01</pagoLocExt><totalSinImpuestos>100.29</totalSinImpuestos><importeTotal>115.33</importeTotal>",
    );
    expect(xml).toContain(
      "<impuestosDocSustento><impuestoDocSustento><codImpuestoDocSustento>2</codImpuestoDocSustento><codigoPorcentaje>4</codigoPorcentaje><baseImponible>100.29</baseImponible><tarifa>15</tarifa><valorImpuesto>15.04</valorImpuesto></impuestoDocSustento></impuestosDocSustento>",
    );
    expect(xml).toContain(
      "<retenciones><retencion><codigo>1</codigo><codigoRetencion>312C</codigoRetencion><baseImponible>100.29</baseImponible><porcentajeRetener>1.75</porcentajeRetener><valorRetenido>1.76</valorRetenido></retencion></retenciones>",
    );
    expect(xml).toContain(
      "<pagos><pago><formaPago>20</formaPago><total>115.33</total></pago></pagos></docSustento>",
    );
    expect(xml).toContain(`<claveAcceso>${BASE.accessKey}</claveAcceso>`);
  });

  it("escribe codDocSustento como los códigos literales de dos caracteres 01, 02 y 03", () => {
    const xml = builder.build(CASES["multiple-supports.xml"]!);
    expect(xml).toContain("<codDocSustento>01</codDocSustento>");
    expect(xml).toContain("<codDocSustento>02</codDocSustento>");
    expect(xml).toContain("<codDocSustento>03</codDocSustento>");
    expect(xml).not.toMatch(/<codDocSustento>[1-3]<\/codDocSustento>/);
    const codes = (() => {
      try {
        builder.build({ ...BASE, supports: [{ ...SUPPORT, documentType: "1" }] });
        return null;
      } catch (error) {
        return error instanceof WithholdingReceiptXmlError ? error.code : String(error);
      }
    })();
    expect(codes).toBe("INVALID_SNAPSHOT_TEXT");
  });

  it("anida las retenciones en su documento y conserva el orden y las autorizaciones", () => {
    const xml = compact(builder.build(CASES["multiple-supports.xml"]!));
    const supports = xml.split("<docSustento>").slice(1);
    expect(supports).toHaveLength(3);
    expect(
      supports.map((s) => [...s.matchAll(/<codigoRetencion>([^<]*)</g)].map((m) => m[1])),
    ).toEqual([["303", "3"], ["343"], ["311", "2", "11"]]);
    expect(supports[0]).toContain(
      "<numAutDocSustento>0110202601179123456700110010010000001231234567815</numAutDocSustento>",
    );
    expect(supports[1]).toContain("<numAutDocSustento>1122334455</numAutDocSustento>");
    expect(supports[2]).not.toContain("<numAutDocSustento>");
    expect(xml).toContain("<parteRel>SI</parteRel>");
    expect(xml).toContain("<periodoFiscal>09/2026</periodoFiscal>");
  });

  it("escribe la retención en cero con el código 7 y el valor 0.00 explícitos", () => {
    const xml = compact(builder.build(CASES["zero-rate.xml"]!));
    expect(xml).toContain(
      "<retencion><codigo>2</codigo><codigoRetencion>7</codigoRetencion><baseImponible>15.04</baseImponible><porcentajeRetener>0</porcentajeRetener><valorRetenido>0.00</valorRetenido></retencion>",
    );
  });

  it("conserva todos los impuestos declarados de cada documento en su orden", () => {
    const xml = compact(builder.build(CASES["support-taxes.xml"]!));
    const supports = xml.split("<docSustento>").slice(1);
    const taxes = (s: string) =>
      [
        ...s.matchAll(
          /<codImpuestoDocSustento>(\d)<\/codImpuestoDocSustento><codigoPorcentaje>(\d+)<\/codigoPorcentaje>/g,
        ),
      ].map((m) => `${m[1]}:${m[2]}`);
    expect(supports.map(taxes)).toEqual([
      ["2:4"],
      ["2:4", "3:3011"],
      ["2:4", "5:5001"],
      ["2:4", "2:0", "2:6", "2:7"],
    ]);
    expect(xml).toContain("<tarifa>150</tarifa><valorImpuesto>150.00</valorImpuesto>");
    expect(xml).toContain("<tarifa>0.02</tarifa><valorImpuesto>0.02</valorImpuesto>");
  });

  it("siempre escribe pagoLocExt 01 y nunca los elementos que el sistema no emite", () => {
    for (const snapshot of Object.values(CASES)) {
      const xml = builder.build(snapshot);
      expect(xml.match(/<pagoLocExt>01<\/pagoLocExt>/g)).toHaveLength(snapshot.supports.length);
      for (const absent of [
        "<tipoSujetoRetenido>",
        "<fechaRegistroContable>",
        "<tipoRegi>",
        "<paisEfecPago>",
        "<aplicConvDobTrib>",
        "<pagExtSujRetNorLeg>",
        "<pagoRegFis>",
        "<totalComprobantesReembolso>",
        "<totalBaseImponibleReembolso>",
        "<totalImpuestoReembolso>",
        "<reembolsos>",
        "<dividendos>",
        "<compraCajBanano>",
        "<maquinaFiscal>",
        "<infoAdicional>",
      ]) {
        expect(xml).not.toContain(absent);
      }
    }
  });

  it("rechaza otra versión del esquema, un importe que no es decimal y un texto que XML no admite", () => {
    const codeOf = (snapshot: WithholdingReceiptXmlSnapshot) => {
      try {
        builder.build(snapshot);
        return null;
      } catch (error) {
        return error instanceof WithholdingReceiptXmlError ? error.code : String(error);
      }
    };
    expect(codeOf({ ...BASE, schemaVersion: "1.0.0" })).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(codeOf({ ...BASE, supports: [{ ...SUPPORT, importTotal: "115,33" }] })).toBe(
      "INVALID_SNAPSHOT_AMOUNT",
    );
    expect(
      codeOf({
        ...BASE,
        supports: [{ ...SUPPORT, withholdings: [income("312C", "1e2", "1.75", "1.76")] }],
      }),
    ).toBe("INVALID_SNAPSHOT_AMOUNT");
    expect(codeOf({ ...BASE, subject: { ...BASE.subject, legalName: "control \u0001" } })).toBe(
      "INVALID_SNAPSHOT_TEXT",
    );
    expect(codeOf({ ...BASE, supports: [{ ...SUPPORT, number: "001-001-0000123" }] })).toBe(
      "INVALID_SNAPSHOT_TEXT",
    );
  });

  it("el builder no usa number ni el builder de alto nivel de la dependencia", () => {
    const source = readFileSync(
      path("../../src/modules/sri-engine/infrastructure/withholding-receipt-xml-builder.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\b(Number|parseFloat|parseInt)\(|toFixed|buildDocumentXml/);
  });
});

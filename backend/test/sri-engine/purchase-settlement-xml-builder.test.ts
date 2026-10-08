// Builder propio de la liquidación de compra 1.1.0 (add-purchase-settlements, tarea 5.1, design D15):
// función pura de su snapshot, sin `number`, en el orden del XSD `LiquidacionCompra_V1.1.0`, con el
// texto escapado, el descuento siempre presente, `plazo` y `unidadTiempo` en cada pago, la moneda
// `DOLAR` y sin los elementos que el sistema no escribe ni las declaraciones de procedencia. Golden
// fixtures de bytes exactos, cada uno validado contra el XSD oficial registrado. Para regenerarlos a
// propósito: `PURCHASE_SETTLEMENT_XML_UPDATE=1`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PurchaseSettlementXmlError,
  type PurchaseSettlementXmlSnapshot,
} from "../../src/modules/sri-engine/application/ports.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createPurchaseSettlementXmlBuilder } from "../../src/modules/sri-engine/infrastructure/purchase-settlement-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const FIXTURES = path("../fixtures/purchase-settlement-xml/");
const UPDATE = process.env.PURCHASE_SETTLEMENT_XML_UPDATE === "1";
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
const liquidacionCompra = registeredSchema(registry, "03", "1.1.0")!;
const xsd = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const builder = createPurchaseSettlementXmlBuilder();

type Line = PurchaseSettlementXmlSnapshot["lines"][number];

const iva = (rateCode: string, rate: string, base: string, amount: string) => ({
  taxCode: "2",
  rateCode,
  rate,
  base,
  amount,
});

const CACAO: Line = {
  mainCode: null,
  auxiliaryCode: null,
  description: "Saco de cacao en grano, 45 kg",
  unit: "saco",
  quantity: "10",
  unitPrice: "4.5",
  discount: "5.00",
  taxableBase: "40.00",
  tax: iva("4", "15", "40.00", "6.00"),
};
const JORNAL: Line = {
  mainCode: "JOR-01",
  auxiliaryCode: null,
  description: "Jornal de cosecha",
  unit: null,
  quantity: "2",
  unitPrice: "30",
  discount: "0.00",
  taxableBase: "60.00",
  tax: iva("0", "0", "60.00", "0.00"),
};

const BASE: PurchaseSettlementXmlSnapshot = {
  schemaVersion: "1.1.0",
  environment: "1",
  issueDate: "2026-10-07",
  accessKey: "0710202603179001234500110010020000000011234567813",
  sequential: "000000001",
  issuer: {
    ruc: "1790012345001",
    legalName: "DISTRIBUIDORA NACIONAL S.A.",
    tradeName: null,
    headOfficeAddress: "Av. Amazonas N24-03, Quito",
    establishment: "001",
    emissionPoint: "002",
    establishmentAddress: "Av. 6 de Diciembre N33-55, Quito",
    specialTaxpayerNumber: null,
    accountingRequired: true,
    withholdingAgentResolution: null,
    rimpe: false,
  },
  supplier: {
    identificationType: "05",
    identification: "0102030405",
    legalName: "María Quishpe",
    address: "Comunidad San Pablo, Cayambe",
  },
  lines: [CACAO, JORNAL],
  totals: {
    withoutTaxes: "100.00",
    discount: "5.00",
    taxes: [iva("0", "0", "60.00", "0.00"), iva("4", "15", "40.00", "6.00")],
    total: "106.00",
  },
  currency: "DOLAR",
  payments: [
    { method: "01", total: "50.00", term: "0", timeUnit: "días" },
    { method: "20", total: "56.00", term: "30", timeUnit: "días" },
  ],
};

const CASES: Record<string, PurchaseSettlementXmlSnapshot> = {
  "cedula-product-and-free-line.xml": {
    ...BASE,
    lines: [{ ...CACAO, mainCode: "CAC-01" }, JORNAL],
  },
  "passport-several-rates.xml": {
    ...BASE,
    issuer: {
      ...BASE.issuer,
      tradeName: "DINASA",
      specialTaxpayerNumber: "12345",
      withholdingAgentResolution: "1",
      accountingRequired: false,
      rimpe: true,
    },
    supplier: {
      identificationType: "06",
      identification: "AB1234567",
      legalName: "Juan Pérez",
      address: "Sector La Esperanza, km 12 vía a Tulcán",
    },
    lines: [
      { ...CACAO, discount: "0.00", taxableBase: "45.00", tax: iva("4", "15", "45.00", "6.75") },
      { ...JORNAL, discount: "10.00", taxableBase: "50.00", tax: iva("0", "0", "50.00", "0.00") },
      {
        ...JORNAL,
        mainCode: null,
        description: "Transporte en acémila",
        taxableBase: "60.00",
        tax: iva("6", "0", "60.00", "0.00"),
      },
      {
        ...JORNAL,
        mainCode: null,
        description: "Semilla certificada",
        taxableBase: "60.00",
        tax: iva("7", "0", "60.00", "0.00"),
      },
      {
        ...CACAO,
        description: "Leña seca",
        unit: "carga",
        quantity: "4",
        unitPrice: "12.5",
        discount: "0.00",
        taxableBase: "50.00",
        tax: iva("5", "5", "50.00", "2.50"),
      },
    ],
    totals: {
      withoutTaxes: "265.00",
      discount: "10.00",
      taxes: [
        iva("0", "0", "50.00", "0.00"),
        iva("4", "15", "45.00", "6.75"),
        iva("5", "5", "50.00", "2.50"),
        iva("6", "0", "60.00", "0.00"),
        iva("7", "0", "60.00", "0.00"),
      ],
      total: "274.25",
    },
    payments: [{ method: "20", total: "274.25", term: "15.5", timeUnit: "días" }],
  },
  "six-decimals.xml": {
    ...BASE,
    lines: [
      {
        ...CACAO,
        quantity: "1.333333",
        unitPrice: "3.000003",
        discount: "0.00",
        taxableBase: "4.00",
        tax: iva("4", "15", "4.00", "0.60"),
      },
      {
        ...JORNAL,
        quantity: "999999.999999",
        unitPrice: "0.000001",
        taxableBase: "1.00",
        tax: iva("0", "0", "1.00", "0.00"),
      },
    ],
    totals: {
      withoutTaxes: "5.00",
      discount: "0.00",
      taxes: [iva("0", "0", "1.00", "0.00"), iva("4", "15", "4.00", "0.60")],
      total: "5.60",
    },
    payments: [{ method: "01", total: "5.60", term: "0", timeUnit: "días" }],
  },
  "special-characters.xml": {
    ...BASE,
    supplier: {
      ...BASE.supplier,
      legalName: "Peña & Cía <Ñandú> \"José\" 'Ángel'",
      address: "Barrio «Los Álamos» Nº 5 & Pasaje <B>",
    },
    lines: [{ ...CACAO, description: 'Café & cacao <orgánico> "fino"', unit: "qq & ½" }, JORNAL],
    payments: [
      { method: "01", total: "50.00", term: "0", timeUnit: "días" },
      { method: "20", total: "56.00", term: "1", timeUnit: "mes & día" },
    ],
  },
  "maximum-lengths.xml": {
    ...BASE,
    supplier: {
      identificationType: "06",
      identification: "P".repeat(20),
      legalName: "Ñ".repeat(300),
      address: "á".repeat(300),
    },
    lines: [
      {
        ...CACAO,
        mainCode: "C".repeat(25),
        auxiliaryCode: "A".repeat(25),
        description: "é".repeat(300),
        unit: "u".repeat(50),
        quantity: "999999999999.999999",
        unitPrice: "0.000001",
        discount: "0.00",
        taxableBase: "1.00",
        tax: iva("4", "15", "1.00", "0.15"),
      },
    ],
    totals: {
      withoutTaxes: "1.00",
      discount: "0.00",
      taxes: [iva("4", "15", "1.00", "0.15")],
      total: "1.15",
    },
    payments: [{ method: "19", total: "1.15", term: "99999999999999", timeUnit: "x".repeat(10) }],
  },
};

const compact = (xml: string) => xml.replace(/>\s+</g, "><");

/** Compara con el golden, o lo escribe cuando se regenera a propósito. */
function matchesGolden(name: string, actual: string) {
  const file = `${FIXTURES}${name}`;
  if (UPDATE || !existsSync(file)) {
    expect(UPDATE, `falta el golden ${name}: generarlo con PURCHASE_SETTLEMENT_XML_UPDATE=1`).toBe(
      true,
    );
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

const codeOf = (snapshot: PurchaseSettlementXmlSnapshot) => {
  try {
    builder.build(snapshot);
    return null;
  } catch (error) {
    return error instanceof PurchaseSettlementXmlError ? error.code : String(error);
  }
};

describe("builder de la liquidación de compra 1.1.0", () => {
  for (const [name, snapshot] of Object.entries(CASES)) {
    it(`${name}: bytes exactos y válido contra LiquidacionCompra_V1.1.0.xsd`, async () => {
      const xml = builder.build(snapshot);
      matchesGolden(name, xml);
      expect(await xsd.validate(xml, liquidacionCompra)).toEqual({ valid: true });
    });
  }

  it("escribe la cabecera, el proveedor, los totales y los pagos en el orden del XSD", () => {
    const xml = compact(builder.build(BASE));
    expect(xml).toContain('<liquidacionCompra id="comprobante" version="1.1.0">');
    expect(xml).toContain("<codDoc>03</codDoc>");
    expect(xml).toContain(
      "<infoLiquidacionCompra><fechaEmision>07/10/2026</fechaEmision><dirEstablecimiento>Av. 6 de Diciembre N33-55, Quito</dirEstablecimiento><obligadoContabilidad>SI</obligadoContabilidad><tipoIdentificacionProveedor>05</tipoIdentificacionProveedor><razonSocialProveedor>María Quishpe</razonSocialProveedor><identificacionProveedor>0102030405</identificacionProveedor><direccionProveedor>Comunidad San Pablo, Cayambe</direccionProveedor><totalSinImpuestos>100.00</totalSinImpuestos><totalDescuento>5.00</totalDescuento><totalConImpuestos><totalImpuesto><codigo>2</codigo><codigoPorcentaje>0</codigoPorcentaje><baseImponible>60.00</baseImponible><tarifa>0</tarifa><valor>0.00</valor></totalImpuesto><totalImpuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><baseImponible>40.00</baseImponible><tarifa>15</tarifa><valor>6.00</valor></totalImpuesto></totalConImpuestos><importeTotal>106.00</importeTotal><moneda>DOLAR</moneda><pagos><pago><formaPago>01</formaPago><total>50.00</total><plazo>0</plazo><unidadTiempo>días</unidadTiempo></pago><pago><formaPago>20</formaPago><total>56.00</total><plazo>30</plazo><unidadTiempo>días</unidadTiempo></pago></pagos></infoLiquidacionCompra>",
    );
  });

  it("escribe cada detalle con el descuento siempre presente y su único impuesto, el IVA", () => {
    const xml = compact(builder.build(BASE));
    expect(xml).toContain(
      "<detalles><detalle><descripcion>Saco de cacao en grano, 45 kg</descripcion><unidadMedida>saco</unidadMedida><cantidad>10</cantidad><precioUnitario>4.5</precioUnitario><descuento>5.00</descuento><precioTotalSinImpuesto>40.00</precioTotalSinImpuesto><impuestos><impuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><tarifa>15</tarifa><baseImponible>40.00</baseImponible><valor>6.00</valor></impuesto></impuestos></detalle><detalle><codigoPrincipal>JOR-01</codigoPrincipal><descripcion>Jornal de cosecha</descripcion><cantidad>2</cantidad><precioUnitario>30</precioUnitario><descuento>0.00</descuento>",
    );
  });

  it("nunca escribe los elementos que el sistema no emite, las declaraciones ni nodos vacíos", () => {
    for (const snapshot of Object.values(CASES)) {
      const xml = builder.build(snapshot);
      for (const absent of [
        "<reembolsos>",
        "<codDocReembolso>",
        "<totalComprobantesReembolso>",
        "<descuentoAdicional>",
        "<precioSinSubsidio>",
        "<detallesAdicionales>",
        "<tipoNegociable>",
        "<maquinaFiscal>",
        "<infoAdicional>",
        "USER_DECLARED",
        "NATURAL_PERSON",
        "declar",
      ]) {
        expect(xml).not.toContain(absent);
      }
      expect(xml).not.toMatch(/<(\w+)><\/\1>|<\w+\/>/);
    }
  });

  it("rechaza otra versión del esquema, un importe que no es decimal y textos fuera del XSD", () => {
    expect(codeOf({ ...BASE, schemaVersion: "1.0.0" })).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(codeOf({ ...BASE, lines: [{ ...CACAO, quantity: "10,5" }] })).toBe(
      "INVALID_SNAPSHOT_AMOUNT",
    );
    expect(codeOf({ ...BASE, payments: [{ ...BASE.payments[0]!, term: "30 días" }] })).toBe(
      "INVALID_SNAPSHOT_AMOUNT",
    );
    for (const snapshot of [
      { ...BASE, supplier: { ...BASE.supplier, identificationType: "09" } },
      { ...BASE, supplier: { ...BASE.supplier, identification: "1".repeat(21) } },
      { ...BASE, supplier: { ...BASE.supplier, address: "a".repeat(301) } },
      { ...BASE, supplier: { ...BASE.supplier, address: "Calle\nprincipal" } },
      { ...BASE, lines: [{ ...CACAO, description: "x".repeat(301) }] },
      { ...BASE, lines: [{ ...CACAO, unit: "u".repeat(51) }] },
      { ...BASE, lines: [{ ...CACAO, tax: { ...CACAO.tax, taxCode: "3" } }] },
      { ...BASE, payments: [{ ...BASE.payments[0]!, timeUnit: "quincenales" }] },
      { ...BASE, payments: [{ ...BASE.payments[0]!, method: "22" }] },
      { ...BASE, lines: [{ ...CACAO, description: "Cacao\u0000" }] },
      { ...BASE, lines: [] },
      { ...BASE, payments: [] },
    ]) {
      expect(codeOf(snapshot), JSON.stringify(snapshot).slice(0, 80)).toBe("INVALID_SNAPSHOT_TEXT");
    }
  });

  it("es determinista: el mismo snapshot da los mismos bytes", () => {
    expect(builder.build(BASE)).toBe(builder.build(structuredClone(BASE)));
  });
});

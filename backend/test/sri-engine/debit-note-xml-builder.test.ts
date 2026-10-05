// Builder propio de la nota de débito 1.0.0 (add-debit-notes, tarea 4.1, design D16): función pura de
// su snapshot, sin `number`, en el orden del XSD `NotaDebito_V1.0.0`, con el texto escapado y
// siempre con `pagos` (un solo `pago`), aunque el XSD permita omitirlo. Golden fixtures de bytes
// exactos, cada uno validado contra el XSD oficial registrado. Para regenerarlos a propósito:
// `DEBIT_NOTE_XML_UPDATE=1`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DebitNoteXmlError,
  type DebitNoteXmlSnapshot,
} from "../../src/modules/sri-engine/application/ports.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createDebitNoteXmlBuilder } from "../../src/modules/sri-engine/infrastructure/debit-note-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const FIXTURES = path("../fixtures/debit-note-xml/");
const UPDATE = process.env.DEBIT_NOTE_XML_UPDATE === "1";
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
const notaDebito = registeredSchema(registry, "05", "1.0.0")!;
const xsd = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const builder = createDebitNoteXmlBuilder();

const iva = (rateCode: string, rate: string, base: string, amount: string) => ({
  taxCode: "2",
  rateCode,
  rate,
  base,
  amount,
});

const BASE: DebitNoteXmlSnapshot = {
  schemaVersion: "1.0.0",
  environment: "1",
  issueDate: "2026-10-09",
  accessKey: "0910202605179001234500110010010000000011234567811",
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
    withholdingAgentResolution: null,
    rimpe: false,
  },
  buyer: {
    identificationType: "04",
    identification: "0992877878001",
    legalName: "EL PERNO CIA. LTDA.",
  },
  modified: { documentType: "01", documentNumber: "001-001-000000041", issueDate: "2026-09-01" },
  withoutTaxes: "100.00",
  taxes: [iva("4", "15", "100.00", "15.00")],
  total: "115.00",
  payment: { method: "20", total: "115.00" },
  reasons: [{ reason: "Intereses por 30 días de mora", value: "100.00" }],
};

const CASES: Record<string, DebitNoteXmlSnapshot> = {
  // Un concepto de intereses de mora al 15 %.
  "one-concept.xml": BASE,
  // Tres conceptos de una tarifa: el impuesto se materializa una vez sobre 0.30.
  "same-rate.xml": {
    ...BASE,
    sequential: "000000002",
    accessKey: "0910202605179001234500110010010000000021234567818",
    withoutTaxes: "0.30",
    taxes: [iva("4", "15", "0.30", "0.05")],
    total: "0.35",
    payment: { method: "01", total: "0.35" },
    reasons: [
      { reason: "Interés del primer período", value: "0.10" },
      { reason: "Interés del segundo período", value: "0.10" },
      { reason: "Interés del tercer período", value: "0.10" },
    ],
  },
  // Varias tarifas de la factura: 15 %, 0 %, no objeto y exento, cada una con su impuesto.
  "multiple-rates.xml": {
    ...BASE,
    sequential: "000000003",
    accessKey: "0910202605179001234500110010010000000031234567814",
    withoutTaxes: "80.00",
    taxes: [
      iva("0", "0", "20.00", "0.00"),
      iva("4", "15", "50.00", "7.50"),
      iva("6", "0", "6.00", "0.00"),
      iva("7", "0", "4.00", "0.00"),
    ],
    total: "87.50",
    payment: { method: "19", total: "87.50" },
    reasons: [
      { reason: "Intereses de mora", value: "50.00" },
      { reason: "Flete posterior a la venta", value: "20.00" },
      { reason: "Gasto notarial", value: "6.00" },
      { reason: "Gasto de envío de documentos", value: "4.00" },
    ],
  },
  // Comprador y textos con caracteres especiales; emisor con nombre comercial, contribuyente
  // especial, agente de retención y RIMPE; ambiente de producción.
  "special-characters.xml": {
    ...BASE,
    environment: "2",
    sequential: "000000004",
    accessKey: "0910202605179001234500220010010000000041234567810",
    issuer: {
      ...BASE.issuer,
      tradeName: 'Ferretería "La Ñusta" & Cía.',
      specialTaxpayerNumber: "12345",
      withholdingAgentResolution: "1",
      rimpe: true,
      accountingRequired: false,
    },
    buyer: {
      identificationType: "05",
      identification: "1710034065",
      legalName: "Peña & Asociados <Construcciones> 'Ñandú'",
    },
    withoutTaxes: "12.34",
    taxes: [iva("4", "15", "12.34", "1.85")],
    total: "14.19",
    payment: { method: "01", total: "14.19" },
    reasons: [{ reason: 'Mora — factura "N° 41" & recargo <legal>', value: "12.34" }],
  },
};

/** El XML sin la sangría entre etiquetas, para buscar secuencias de elementos. */
const compact = (xml: string) => xml.replace(/>\s+</g, "><");

/** Compara con el golden, o lo escribe cuando se regenera a propósito. */
function matchesGolden(name: string, actual: string) {
  const file = `${FIXTURES}${name}`;
  if (UPDATE || !existsSync(file)) {
    expect(UPDATE, `falta el golden ${name}: generarlo con DEBIT_NOTE_XML_UPDATE=1`).toBe(true);
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

describe("builder de la nota de débito 1.0.0", () => {
  for (const [name, snapshot] of Object.entries(CASES)) {
    it(`${name}: bytes exactos y válido contra NotaDebito_V1.0.0.xsd`, async () => {
      const xml = builder.build(snapshot);
      matchesGolden(name, xml);
      expect(await xsd.validate(xml, notaDebito)).toEqual({ valid: true });
    });
  }

  it("transcribe el comprobante modificado, los motivos, la forma de pago y la clave de la nota", () => {
    const xml = compact(builder.build(BASE));
    expect(xml).toContain('<notaDebito id="comprobante" version="1.0.0">');
    expect(xml).toContain("<codDoc>05</codDoc>");
    expect(xml).toContain("<codDocModificado>01</codDocModificado>");
    expect(xml).toContain("<numDocModificado>001-001-000000041</numDocModificado>");
    expect(xml).toContain("<fechaEmisionDocSustento>01/09/2026</fechaEmisionDocSustento>");
    expect(xml).toContain(
      "<impuesto><codigo>2</codigo><codigoPorcentaje>4</codigoPorcentaje><tarifa>15</tarifa><baseImponible>100.00</baseImponible><valor>15.00</valor></impuesto>",
    );
    expect(xml).toContain("<valorTotal>115.00</valorTotal>");
    expect(xml).toContain(
      "<pagos><pago><formaPago>20</formaPago><total>115.00</total></pago></pagos>",
    );
    expect(xml).toContain(
      "<motivos><motivo><razon>Intereses por 30 días de mora</razon><valor>100.00</valor></motivo></motivos>",
    );
    expect(xml).toContain(`<claveAcceso>${BASE.accessKey}</claveAcceso>`);
  });

  it("siempre escribe exactamente un pago y nunca los elementos que el sistema no emite", () => {
    for (const snapshot of Object.values(CASES)) {
      const xml = builder.build(snapshot);
      expect(xml.match(/<pago>/g)).toHaveLength(1);
      for (const absent of [
        "<rise>",
        "<compensaciones>",
        "<valorDevolucionIva>",
        "<plazo>",
        "<unidadTiempo>",
        "<maquinaFiscal>",
        "<infoAdicional>",
        "<detalles>",
      ]) {
        expect(xml).not.toContain(absent);
      }
    }
  });

  it("escribe los motivos en el orden de los conceptos y el texto decimal exacto del snapshot", () => {
    const xml = builder.build(CASES["multiple-rates.xml"]!);
    const reasons = [...xml.matchAll(/<razon>([^<]*)<\/razon>/g)].map((match) => match[1]);
    expect(reasons).toEqual([
      "Intereses de mora",
      "Flete posterior a la venta",
      "Gasto notarial",
      "Gasto de envío de documentos",
    ]);
    expect(xml).toContain("<tarifa>0</tarifa>");
  });

  it("rechaza otra versión del esquema, un importe que no es decimal y un texto que XML no admite", () => {
    const codeOf = (snapshot: DebitNoteXmlSnapshot) => {
      try {
        builder.build(snapshot);
        return null;
      } catch (error) {
        return error instanceof DebitNoteXmlError ? error.code : String(error);
      }
    };
    expect(codeOf({ ...BASE, schemaVersion: "1.1.0" })).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(codeOf({ ...BASE, total: "115,00" })).toBe("INVALID_SNAPSHOT_AMOUNT");
    expect(codeOf({ ...BASE, payment: { method: "20", total: "1e2" } })).toBe(
      "INVALID_SNAPSHOT_AMOUNT",
    );
    expect(codeOf({ ...BASE, reasons: [{ reason: "control \u0001", value: "1.00" }] })).toBe(
      "INVALID_SNAPSHOT_TEXT",
    );
  });

  it("el builder no usa number ni el builder de alto nivel de la dependencia", () => {
    const source = readFileSync(
      path("../../src/modules/sri-engine/infrastructure/debit-note-xml-builder.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\b(Number|parseFloat|parseInt)\(|toFixed|buildDocumentXml/);
  });
});

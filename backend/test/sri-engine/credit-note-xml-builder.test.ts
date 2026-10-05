// Builder propio de la nota de crédito 1.1.0 (add-credit-notes, tarea 4.1, design D12): función pura
// de su snapshot, sin `number`, en el orden del XSD `NotaCredito_V1.1.0`, con el texto escapado.
// Golden fixtures de bytes exactos, cada uno validado contra el XSD oficial registrado. Para
// regenerarlos a propósito: `CREDIT_NOTE_XML_UPDATE=1`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CreditNoteXmlError,
  type CreditNoteXmlSnapshot,
} from "../../src/modules/sri-engine/application/ports.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createCreditNoteXmlBuilder } from "../../src/modules/sri-engine/infrastructure/credit-note-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const FIXTURES = path("../fixtures/credit-note-xml/");
const UPDATE = process.env.CREDIT_NOTE_XML_UPDATE === "1";
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
const notaCredito = registeredSchema(registry, "04", "1.1.0")!;
const xsd = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const builder = createCreditNoteXmlBuilder();

const iva = (rateCode: string, rate: string, base: string, value: string) => ({
  taxCode: "2",
  rateCode,
  rate,
  base,
  amount: value,
});

const BASE: CreditNoteXmlSnapshot = {
  schemaVersion: "1.1.0",
  environment: "1",
  issueDate: "2026-10-05",
  accessKey: "0510202604179001234500110010010000000011234567814",
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
  modified: { documentType: "01", documentNumber: "001-001-000000041", issueDate: "2026-10-01" },
  lines: [
    {
      mainCode: "CEM-50",
      auxiliaryCode: null,
      description: "Cemento 50 kg",
      quantity: "1",
      unitPrice: "10.00",
      discount: "1.00",
      taxableBase: "9.00",
      taxes: [iva("4", "15", "9.00", "1.35")],
    },
  ],
  totals: {
    withoutTaxes: "9.00",
    taxes: [{ taxCode: "2", rateCode: "4", base: "9.00", amount: "1.35" }],
    total: "10.35",
  },
  reason: "Devolución de una unidad",
};

const CASES: Record<string, CreditNoteXmlSnapshot> = {
  // Devolución parcial: 1 de 3 unidades a 10.00 con descuento original de 3.00 e IVA del 15 %.
  "partial-return.xml": BASE,
  // Varias líneas y tarifas: IVA 15 %, 5 % y 0 %, con cantidades de 6 decimales.
  "multiple-rates.xml": {
    ...BASE,
    sequential: "000000002",
    accessKey: "0510202604179001234500110010010000000021234567810",
    lines: [
      {
        mainCode: "CEM-50",
        auxiliaryCode: "7861234500017",
        description: "Cemento 50 kg",
        quantity: "2",
        unitPrice: "8.75",
        discount: "0.00",
        taxableBase: "17.50",
        taxes: [iva("4", "15", "17.50", "2.63")],
      },
      {
        mainCode: "MAT-01",
        auxiliaryCode: null,
        description: "Materiales de construcción",
        quantity: "0.333333",
        unitPrice: "12.000000",
        discount: "0.00",
        taxableBase: "4.00",
        taxes: [iva("5", "5", "4.00", "0.20")],
      },
      {
        mainCode: null,
        auxiliaryCode: null,
        description: "Libro técnico",
        quantity: "1",
        unitPrice: "20.00",
        discount: "2.00",
        taxableBase: "18.00",
        taxes: [iva("0", "0", "18.00", "0.00")],
      },
    ],
    totals: {
      withoutTaxes: "39.50",
      taxes: [
        { taxCode: "2", rateCode: "4", base: "17.50", amount: "2.63" },
        { taxCode: "2", rateCode: "5", base: "4.00", amount: "0.20" },
        { taxCode: "2", rateCode: "0", base: "18.00", amount: "0.00" },
      ],
      total: "42.33",
    },
    reason: "Devolución de mercadería en mal estado",
  },
  // Anulación total: cada línea de la factura completa y el valor de la modificación es su total.
  "total-annulment.xml": {
    ...BASE,
    sequential: "000000003",
    accessKey: "0510202604179001234500110010010000000031234567817",
    lines: [
      {
        mainCode: "CEM-50",
        auxiliaryCode: null,
        description: "Cemento 50 kg",
        quantity: "3",
        unitPrice: "8.75",
        discount: "1.25",
        taxableBase: "25.00",
        taxes: [iva("4", "15", "25.00", "3.75")],
      },
    ],
    totals: {
      withoutTaxes: "25.00",
      taxes: [{ taxCode: "2", rateCode: "4", base: "25.00", amount: "3.75" }],
      total: "28.75",
    },
    reason: "Anulación de la factura 001-001-000000041",
  },
  // Comprador y textos con caracteres especiales; emisor con nombre comercial, contribuyente
  // especial, agente de retención y RIMPE.
  "special-characters.xml": {
    ...BASE,
    environment: "2",
    sequential: "000000004",
    accessKey: "0510202604179001234500220010010000000041234567819",
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
    lines: [
      {
        mainCode: 'TUB-1/2"',
        auxiliaryCode: "A&B<1>",
        description: "Tubo PVC ½\" — presión <alta> & 'reforzado'",
        quantity: "1.5",
        unitPrice: "4.200000",
        discount: "0.30",
        taxableBase: "6.00",
        taxes: [iva("4", "15", "6.00", "0.90")],
      },
    ],
    totals: {
      withoutTaxes: "6.00",
      taxes: [{ taxCode: "2", rateCode: "4", base: "6.00", amount: "0.90" }],
      total: "6.90",
    },
    reason: 'Devolución: producto con fallas — garantía "N° 12" & cambio <inmediato>',
  },
};

/** Compara con el golden, o lo escribe cuando se regenera a propósito. */
function matchesGolden(name: string, actual: string) {
  const file = `${FIXTURES}${name}`;
  if (UPDATE || !existsSync(file)) {
    expect(UPDATE, `falta el golden ${name}: generarlo con CREDIT_NOTE_XML_UPDATE=1`).toBe(true);
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  expect(actual).toBe(readFileSync(file, "utf8"));
}

describe("builder de la nota de crédito 1.1.0", () => {
  for (const [name, snapshot] of Object.entries(CASES)) {
    it(`${name}: bytes exactos y válido contra NotaCredito_V1.1.0.xsd`, async () => {
      const xml = builder.build(snapshot);
      matchesGolden(name, xml);
      expect(await xsd.validate(xml, notaCredito)).toEqual({ valid: true });
    });
  }

  it("transcribe el comprobante modificado, el motivo y la clave de la nota, nunca la de la factura", () => {
    const xml = builder.build(BASE);
    expect(xml).toContain("<codDoc>04</codDoc>");
    expect(xml).toContain("<codDocModificado>01</codDocModificado>");
    expect(xml).toContain("<numDocModificado>001-001-000000041</numDocModificado>");
    expect(xml).toContain("<fechaEmisionDocSustento>01/10/2026</fechaEmisionDocSustento>");
    expect(xml).toContain("<valorModificacion>10.35</valorModificacion>");
    expect(xml).toContain("<motivo>Devolución de una unidad</motivo>");
    expect(xml).toContain(`<claveAcceso>${BASE.accessKey}</claveAcceso>`);
    expect(xml).not.toContain("<pagos>");
    expect(xml).not.toContain("direccionComprador");
  });

  it("escribe el texto decimal exacto del snapshot, sin formatear", () => {
    const xml = builder.build(CASES["multiple-rates.xml"]!);
    expect(xml).toContain("<cantidad>0.333333</cantidad>");
    expect(xml).toContain("<precioUnitario>12.000000</precioUnitario>");
  });

  it("rechaza otra versión del esquema, un importe que no es decimal y un texto que XML no admite", () => {
    const codeOf = (snapshot: CreditNoteXmlSnapshot) => {
      try {
        builder.build(snapshot);
        return null;
      } catch (error) {
        return error instanceof CreditNoteXmlError ? error.code : String(error);
      }
    };
    expect(codeOf({ ...BASE, schemaVersion: "1.0.0" })).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(codeOf({ ...BASE, totals: { ...BASE.totals, total: "10,35" } })).toBe(
      "INVALID_SNAPSHOT_AMOUNT",
    );
    expect(codeOf({ ...BASE, reason: "Motivo \u0000 inválido" })).toBe("INVALID_SNAPSHOT_TEXT");
  });
});

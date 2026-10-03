// Builder propio de la factura 1.1.0 (add-invoice-emission, tarea 6.2, design D4 y D12; Q-44):
// función pura de su snapshot, sin `number`, en el orden del XSD, con el texto escapado y los
// opcionales solo cuando corresponden. Cada XML se valida contra el XSD registrado.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  InvoiceXmlError,
  type InvoiceSnapshot,
} from "../../src/modules/sri-engine/application/ports.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createInvoiceXmlBuilder } from "../../src/modules/sri-engine/infrastructure/invoice-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
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
const factura = registeredSchema(registry, "01", "1.1.0")!;
const xsd = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const builder = createInvoiceXmlBuilder();

const SNAPSHOT: InvoiceSnapshot = {
  schemaVersion: "1.1.0",
  accessKey: "0310202601179001234500110010010000000011234567816",
  environment: "1",
  issueDate: "2026-10-03",
  sequential: "000000001",
  issuer: {
    ruc: "1790012345001",
    legalName: "COMERCIAL ANDINA S.A.",
    tradeName: null,
    headOfficeAddress: "Quito",
    establishment: "001",
    emissionPoint: "001",
    establishmentAddress: null,
    specialTaxpayerNumber: null,
    accountingRequired: false,
    withholdingAgentResolution: null,
    rimpe: false,
  },
  buyer: {
    identificationType: "07",
    identification: "9999999999999",
    legalName: "CONSUMIDOR FINAL",
    address: null,
  },
  lines: [
    {
      mainCode: null,
      auxiliaryCode: null,
      description: "Servicio",
      quantity: "1",
      unitPrice: "10",
      discount: "0.00",
      taxableBase: "10.00",
      taxes: [{ taxCode: "2", rateCode: "4", rate: "15", base: "10.00", amount: "1.50" }],
    },
  ],
  totals: {
    withoutTaxes: "10.00",
    discount: "0.00",
    taxes: [{ taxCode: "2", rateCode: "4", base: "10.00", amount: "1.50" }],
    total: "11.50",
  },
  payments: [{ method: "01", total: "11.50" }],
};

/** Nombres de los hijos directos de un elemento, en orden. */
const children = (xml: string, parent: string) => {
  const block = new RegExp(`<${parent}>([\\s\\S]*?)\\n {2,4}</${parent}>`).exec(xml)![1]!;
  const depth = /\n( *)</.exec(block)![1]!.length;
  return [...block.matchAll(new RegExp(`\\n {${depth}}<([A-Za-z]+)`, "g"))].map((m) => m[1]);
};
const codeOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof InvoiceXmlError ? error.code : `otro: ${String(error)}`;
  }
};
const withBuyer = (legalName: string): InvoiceSnapshot => ({
  ...SNAPSHOT,
  buyer: {
    ...SNAPSHOT.buyer,
    identificationType: "04",
    identification: "0992877878001",
    legalName,
  },
});

describe("builder propio de la factura 1.1.0", () => {
  it("el snapshot mínimo es válido y omite los opcionales que no corresponden", async () => {
    const xml = builder.build(SNAPSHOT);
    expect(await xsd.validate(xml, factura)).toEqual({ valid: true });
    expect(children(xml, "infoTributaria")).toEqual([
      "ambiente",
      "tipoEmision",
      "razonSocial",
      "ruc",
      "claveAcceso",
      "codDoc",
      "estab",
      "ptoEmi",
      "secuencial",
      "dirMatriz",
    ]);
    expect(children(xml, "infoFactura")).toEqual([
      "fechaEmision",
      "obligadoContabilidad",
      "tipoIdentificacionComprador",
      "razonSocialComprador",
      "identificacionComprador",
      "totalSinImpuestos",
      "totalDescuento",
      "totalConImpuestos",
      "importeTotal",
      "moneda",
      "pagos",
    ]);
    expect(children(xml, "detalle")).toEqual([
      "descripcion",
      "cantidad",
      "precioUnitario",
      "descuento",
      "precioTotalSinImpuesto",
      "impuestos",
    ]);
    expect(xml).not.toContain("<propina>");
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<factura id="comprobante" version="1.1.0">',
      ),
    ).toBe(true);
  });

  it("con todos los opcionales, los escribe en el orden de la secuencia del XSD", async () => {
    const full: InvoiceSnapshot = {
      ...SNAPSHOT,
      issuer: {
        ...SNAPSHOT.issuer,
        tradeName: "ANDINA",
        establishmentAddress: "Guayaquil",
        specialTaxpayerNumber: "12345",
        accountingRequired: true,
        withholdingAgentResolution: "1",
        rimpe: true,
      },
      buyer: {
        identificationType: "04",
        identification: "0992877878001",
        legalName: "EL PERNO",
        address: "Quito",
      },
      lines: [{ ...SNAPSHOT.lines[0]!, mainCode: "A-1", auxiliaryCode: "AUX" }],
      payments: [{ method: "20", total: "11.50" }],
    };
    const xml = builder.build(full);
    expect(await xsd.validate(xml, factura)).toEqual({ valid: true });
    expect(children(xml, "infoTributaria").slice(-5)).toEqual([
      "ptoEmi",
      "secuencial",
      "dirMatriz",
      "agenteRetencion",
      "contribuyenteRimpe",
    ]);
    expect(children(xml, "infoFactura")).toEqual([
      "fechaEmision",
      "dirEstablecimiento",
      "contribuyenteEspecial",
      "obligadoContabilidad",
      "tipoIdentificacionComprador",
      "razonSocialComprador",
      "identificacionComprador",
      "direccionComprador",
      "totalSinImpuestos",
      "totalDescuento",
      "totalConImpuestos",
      "importeTotal",
      "moneda",
      "pagos",
    ]);
    expect(children(xml, "detalle").slice(0, 3)).toEqual([
      "codigoPrincipal",
      "codigoAuxiliar",
      "descripcion",
    ]);
    expect(xml).toContain("<contribuyenteRimpe>CONTRIBUYENTE RÉGIMEN RIMPE</contribuyenteRimpe>");
    expect(xml).toContain("<agenteRetencion>1</agenteRetencion>");
    expect(xml).toContain("<obligadoContabilidad>SI</obligadoContabilidad>");
  });

  it("escribe los importes exactos del snapshot, sin pasar por number", async () => {
    const big: InvoiceSnapshot = {
      ...SNAPSHOT,
      lines: [
        {
          ...SNAPSHOT.lines[0]!,
          quantity: "1",
          unitPrice: "123456789012.123456",
          taxableBase: "123456789012.12",
          taxes: [
            {
              taxCode: "2",
              rateCode: "4",
              rate: "15",
              base: "123456789012.12",
              amount: "18518518351.82",
            },
          ],
        },
      ],
      totals: {
        withoutTaxes: "123456789012.12",
        discount: "0.00",
        taxes: [{ taxCode: "2", rateCode: "4", base: "123456789012.12", amount: "18518518351.82" }],
        total: "141975307363.94",
      },
      payments: [{ method: "01", total: "141975307363.94" }],
    };
    const xml = builder.build(big);
    expect(xml).toContain("<precioUnitario>123456789012.123456</precioUnitario>");
    expect(xml).toContain("<importeTotal>141975307363.94</importeTotal>");
    expect(await xsd.validate(xml, factura)).toEqual({ valid: true });
  });

  it("escapa el texto y conserva UTF-8, y el resultado sigue siendo válido", async () => {
    const xml = builder.build(withBuyer(`FERRETERÍA "PEÑA" & HIJOS <CIA.> 'LTDA.'`));
    expect(xml).toContain(
      `<razonSocialComprador>FERRETERÍA "PEÑA" &amp; HIJOS &lt;CIA.&gt; 'LTDA.'</razonSocialComprador>`,
    );
    expect(await xsd.validate(xml, factura)).toEqual({ valid: true });
  });

  it("rechaza texto con caracteres que XML 1.0 no admite, sin incluir el dato en el error", () => {
    for (const legalName of ["EMPRESA\u0001", "EMPRESA\uD800", "EMPRESA￾", "\u001B[31m"]) {
      let error: unknown;
      try {
        builder.build(withBuyer(legalName));
      } catch (caught) {
        error = caught;
      }
      expect(error, JSON.stringify(legalName)).toBeInstanceOf(InvoiceXmlError);
      expect((error as InvoiceXmlError).code).toBe("INVALID_SNAPSHOT_TEXT");
      expect((error as Error).message).not.toContain("EMPRESA");
    }
  });

  it("rechaza un importe que no es un DecimalString exacto", () => {
    for (const total of ["1e3", "11,50", " 11.50", "11.5.0", ""]) {
      const snapshot = { ...SNAPSHOT, totals: { ...SNAPSHOT.totals, total } };
      expect(
        codeOf(() => builder.build(snapshot)),
        total,
      ).toBe("INVALID_SNAPSHOT_AMOUNT");
    }
  });

  it("solo escribe la versión de esquema que conoce", () => {
    expect(codeOf(() => builder.build({ ...SNAPSHOT, schemaVersion: "2.1.0" }))).toBe(
      "UNSUPPORTED_SCHEMA_VERSION",
    );
    expect(builder.version).toBe("1");
  });

  it("es una función pura: el mismo snapshot congelado da el mismo XML", () => {
    const frozen = structuredClone(SNAPSHOT);
    const deepFreeze = (value: unknown): void => {
      if (value && typeof value === "object") {
        Object.freeze(value);
        Object.values(value).forEach(deepFreeze);
      }
    };
    deepFreeze(frozen);
    expect(builder.build(frozen)).toBe(builder.build(SNAPSHOT));
  });

  it("no convierte importes a number ni lee reloj, entorno, archivos, base de datos o la librería", () => {
    for (const file of ["invoice-xml-builder.ts", "xml-writer.ts"]) {
      const source = readFileSync(
        path(`../../src/modules/sri-engine/infrastructure/${file}`),
        "utf8",
      ).replace(/^\s*\/\/.*$/gm, "");
      expect(source, file).not.toMatch(
        /\b(Number|parseFloat|parseInt)\(|toFixed|new Date|Date\.now|process\.env|node:fs|prisma|facturacion-electronica-ec|Math\.random/,
      );
    }
  });
});

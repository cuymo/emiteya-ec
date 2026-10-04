// Facturas autorizadas para las pruebas del RIDE (add-document-archive): construidas con el builder
// real, validadas contra el XSD registrado y firmadas con un P12 sintético, como las que el sistema
// emite. Los importes se calculan aquí con aritmética entera y HALF_UP, solo para que cada factura
// sea coherente; el RIDE nunca recalcula: dibuja el texto del XML.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { RideRenderInput } from "../../src/modules/sri-engine/application/ride.ts";
import type {
  InvoiceSnapshot,
  RegisteredSchema,
} from "../../src/modules/sri-engine/application/ports.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import { createInvoiceXmlBuilder } from "../../src/modules/sri-engine/infrastructure/invoice-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { FIXTURE_PASSWORD, readFixture } from "./p12-fixtures.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/** Tarifas de IVA por código (tabla 17 de la ficha v2.34), como texto. */
const IVA = { "4": "15", "5": "5", "0": "0", "6": "0", "7": "0" } as const;
export type RateCode = keyof typeof IVA;

export const PAYMENT_LABELS: Readonly<Record<string, string>> = {
  "01": "SIN UTILIZACION DEL SISTEMA FINANCIERO",
  "20": "OTROS CON UTILIZACION DEL SISTEMA FINANCIERO",
};

export type InvoiceLine = Readonly<{
  code: string;
  auxiliaryCode?: string | null;
  description: string;
  /** Hasta 6 decimales. */
  quantity: string;
  /** Hasta 6 decimales. */
  unitPrice: string;
  /** 2 decimales. */
  discount: string;
  rateCode: RateCode;
}>;

export type InvoiceCase = Readonly<{
  name: string;
  issueDate: string;
  sequential: string;
  environment: "1" | "2";
  issuer?: Partial<InvoiceSnapshot["issuer"]>;
  buyer?: InvoiceSnapshot["buyer"];
  lines: readonly InvoiceLine[];
  paymentMethods?: readonly string[];
}>;

export const BASE_ISSUER: InvoiceSnapshot["issuer"] = {
  ruc: "1790012345001",
  legalName: "COMERCIAL ANDINA S.A.",
  tradeName: "ANDINA",
  headOfficeAddress: "Av. Amazonas N24-03, Quito",
  establishment: "001",
  emissionPoint: "001",
  establishmentAddress: "Av. Amazonas N24-03, Quito",
  specialTaxpayerNumber: null,
  accountingRequired: true,
  withholdingAgentResolution: null,
  rimpe: false,
};

export const COMPANY_BUYER: InvoiceSnapshot["buyer"] = {
  identificationType: "04",
  identification: "0992877878001",
  legalName: "FERRETERIA EL PERNO CIA. LTDA.",
  address: "Guayaquil",
};

export const CONSUMER_FINAL: InvoiceSnapshot["buyer"] = {
  identificationType: "07",
  identification: "9999999999999",
  legalName: "CONSUMIDOR FINAL",
  address: null,
};

// Aritmética decimal exacta sobre enteros escalados.
const scale = (value: string, decimals: number): bigint => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole! + fraction.padEnd(decimals, "0").slice(0, decimals));
};
const roundHalfUp = (value: bigint, from: number, to: number): bigint => {
  const factor = 10n ** BigInt(from - to);
  return (value + factor / 2n) / factor;
};
const money = (cents: bigint): string => {
  const text = cents.toString().padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
};

const accessKeys = createAccessKeys();

export function snapshotOf(invoice: InvoiceCase): InvoiceSnapshot {
  const issuer = { ...BASE_ISSUER, ...invoice.issuer };
  const accessKey = accessKeys.compose({
    issueDate: invoice.issueDate,
    documentType: "01",
    ruc: issuer.ruc,
    environment: invoice.environment,
    establishment: issuer.establishment,
    emissionPoint: issuer.emissionPoint,
    sequential: invoice.sequential,
    numericCode: String((Number(invoice.sequential) * 7919) % 100_000_000).padStart(8, "0"),
  });
  const totalsByRate = new Map<RateCode, { base: bigint; amount: bigint }>();
  let withoutTaxes = 0n;
  let discount = 0n;
  const lines = invoice.lines.map((line) => {
    const gross = roundHalfUp(scale(line.quantity, 6) * scale(line.unitPrice, 6), 12, 2);
    const lineDiscount = scale(line.discount, 2);
    const base = gross - lineDiscount;
    const rate = IVA[line.rateCode];
    const amount = roundHalfUp(base * scale(rate, 2), 6, 2);
    withoutTaxes += base;
    discount += lineDiscount;
    const current = totalsByRate.get(line.rateCode) ?? { base: 0n, amount: 0n };
    totalsByRate.set(line.rateCode, { base: current.base + base, amount: current.amount + amount });
    return {
      mainCode: line.code,
      auxiliaryCode: line.auxiliaryCode ?? null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: money(lineDiscount),
      taxableBase: money(base),
      taxes: [
        { taxCode: "2", rateCode: line.rateCode, rate, base: money(base), amount: money(amount) },
      ],
    };
  });
  const taxes = [...totalsByRate.entries()].map(([rateCode, totals]) => ({
    taxCode: "2",
    rateCode,
    base: money(totals.base),
    amount: money(totals.amount),
  }));
  const total = withoutTaxes + [...totalsByRate.values()].reduce((sum, t) => sum + t.amount, 0n);
  const methods = invoice.paymentMethods ?? ["01"];
  // El primer pago lleva el resto, para que la suma sea el total exacto.
  const share = total / BigInt(methods.length);
  const payments = methods.map((method, index) => ({
    method,
    total: money(index === 0 ? total - share * BigInt(methods.length - 1) : share),
  }));
  return {
    schemaVersion: "1.1.0",
    environment: invoice.environment,
    issueDate: invoice.issueDate,
    accessKey,
    sequential: invoice.sequential,
    issuer,
    buyer: invoice.buyer ?? COMPANY_BUYER,
    lines,
    totals: {
      withoutTaxes: money(withoutTaxes),
      discount: money(discount),
      taxes,
      total: money(total),
    },
    payments,
  };
}

let schema: RegisteredSchema | undefined;
function invoiceSchema(): RegisteredSchema {
  if (schema) return schema;
  const entries = (
    JSON.parse(
      readFileSync(path("../../src/modules/catalogs/datasets/schema-registry/2.json"), "utf8"),
    ) as { entries: (SchemaRegistryEntry & { documentType?: string; version?: string })[] }
  ).entries.map((entry) => ({
    ...entry,
    documentType: entry.documentType ?? null,
    version: entry.version ?? null,
    imports: entry.imports ?? [],
  }));
  schema = registeredSchema(entries, "01", "1.1.0")!;
  return schema;
}

const validator = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const builder = createInvoiceXmlBuilder();
const signer = createXmlSigner();

export type AuthorizedInvoice = Readonly<{
  name: string;
  snapshot: InvoiceSnapshot;
  /** Bytes del XML firmado, que el ejemplo usa también como XML autorizado. */
  xml: Buffer;
  input: RideRenderInput;
}>;

/** Fecha de autorización fija de cada factura: el mismo día de emisión, 15:20:11 en Ecuador. */
export const authorizedAtOf = (issueDate: string) => new Date(`${issueDate}T15:20:11.000-05:00`);

/** XML del builder, validado contra el XSD y firmado: el XML autorizado de la factura. */
export async function authorizedInvoice(
  invoice: InvoiceCase,
  p12Dir: string,
): Promise<AuthorizedInvoice> {
  const snapshot = snapshotOf(invoice);
  const unsigned = builder.build(snapshot);
  const result = await validator.validate(unsigned, invoiceSchema());
  if (!("valid" in result) || result.valid !== true) {
    throw new Error(
      `la factura ${invoice.name} no valida contra el XSD: ${JSON.stringify(result)}`,
    );
  }
  const signed = await signer.sign({
    xml: unsigned,
    documentType: "01",
    p12: readFixture(p12Dir, "sd-utf8.modern.p12"),
    password: FIXTURE_PASSWORD,
  });
  const xml = Buffer.from(signed, "utf8");
  return {
    name: invoice.name,
    snapshot,
    xml,
    input: {
      xml,
      accessKey: snapshot.accessKey,
      authorization: {
        number: snapshot.accessKey,
        authorizedAt: authorizedAtOf(invoice.issueDate),
        environment: invoice.environment === "1" ? "TEST" : "PRODUCTION",
      },
      paymentLabels: PAYMENT_LABELS,
      logo: null,
    },
  };
}

export const LONG_NAME =
  "DISTRIBUIDORA DE MATERIALES DE CONSTRUCCIÓN Y FERRETERÍA NÚÑEZ & HIJOS COMPAÑÍA LIMITADA, " +
  "IMPORTACIÓN, EXPORTACIÓN Y COMERCIALIZACIÓN AL POR MAYOR Y MENOR DE ARTÍCULOS DE FERRETERÍA, " +
  "PINTURAS, HERRAMIENTAS Y MAQUINARIA LIVIANA PARA LA INDUSTRIA Y EL HOGAR ÁÉÍÓÚ ÑÑ";
export const LONG_ADDRESS =
  "Av. Francisco de Orellana N° 234 y Calle Doctor José Luis Tamayo, Edificio Torres del Río, " +
  "Bloque C, piso 11, oficina 1104, frente al Parque Lineal, sector Kennedy Norte, Guayaquil.";

export const line = (index: number, overrides: Partial<InvoiceLine> = {}): InvoiceLine => {
  const rates: RateCode[] = ["4", "5", "0", "6", "7"];
  return {
    code: `L${String(index).padStart(3, "0")}`,
    description: `Producto ${index} de prueba fin${index}`,
    quantity: String((index % 7) + 1),
    unitPrice: `${(index % 13) + 1}.${String(index % 100).padStart(2, "0")}`,
    discount: index % 4 === 0 ? "0.50" : "0.00",
    rateCode: rates[index % rates.length]!,
    ...overrides,
  };
};

/** Facturas representativas: tamaños, comprador, leyendas del emisor, Unicode y valores grandes. */
export const INVOICE_CASES = {
  oneLine: {
    name: "una-linea",
    issueDate: "2026-10-03",
    sequential: "000000001",
    environment: "1",
    lines: [line(1, { rateCode: "4", discount: "0.00" })],
  },
  consumerFinal: {
    name: "consumidor-final",
    issueDate: "2026-10-04",
    sequential: "000000002",
    environment: "1",
    buyer: CONSUMER_FINAL,
    lines: [line(2, { quantity: "2", unitPrice: "8.75", rateCode: "4", discount: "0.00" })],
  },
  complete: {
    name: "completa",
    issueDate: "2026-10-04",
    sequential: "000000315",
    environment: "2",
    issuer: {
      legalName: LONG_NAME,
      tradeName: "FERRETERÍA NÚÑEZ — PEÑA & CÍA. «EL MAÑANERO»",
      headOfficeAddress: LONG_ADDRESS,
      establishmentAddress: LONG_ADDRESS,
      withholdingAgentResolution: "1",
      rimpe: true,
      specialTaxpayerNumber: "13216",
    },
    buyer: {
      identificationType: "05",
      identification: "1710034065",
      legalName: "JOSÉ ÁNGEL MUÑOZ IBÁÑEZ Ñ Ü ü ç “Pepe”",
      address: LONG_ADDRESS,
    },
    lines: [
      line(1, { auxiliaryCode: "AUX-1", rateCode: "4", discount: "1.25" }),
      line(2, { description: "Señalética «PELIGRO» – cinta amarilla 3″ × 100 m", rateCode: "5" }),
      line(3, { description: "Ñandú decorativo de cerámica (artesanía, añejo)", rateCode: "0" }),
      line(4, { description: "Servicio no objeto de IVA", rateCode: "6" }),
      line(5, { description: "Libro exento de IVA", rateCode: "7" }),
    ],
    paymentMethods: ["20", "01"],
  },
  multiPage: {
    name: "varias-paginas",
    issueDate: "2026-12-30",
    sequential: "999999999",
    environment: "2",
    buyer: { ...COMPANY_BUYER, legalName: LONG_NAME, address: LONG_ADDRESS },
    lines: Array.from({ length: 120 }, (_, i) =>
      line(i + 1, {
        description:
          i % 9 === 0
            ? `Producto ${i + 1} con una descripción larga que ocupa varias líneas de la tabla del detalle del comprobante para comprobar que una fila nunca se corta entre dos páginas fin${i + 1}`
            : `Producto ${i + 1} de prueba fin${i + 1}`,
      }),
    ),
  },
  largeValues: {
    name: "valores-grandes",
    issueDate: "2027-01-31",
    sequential: "000000077",
    environment: "1",
    lines: [line(1, { quantity: "999999.999999", unitPrice: "1.000001", rateCode: "4" })],
  },
} as const satisfies Record<string, InvoiceCase>;

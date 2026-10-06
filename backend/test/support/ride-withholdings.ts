// Comprobantes de retención autorizados para las pruebas del RIDE (add-withholding-receipts, design
// D19): el XML del builder `comprobanteRetencion` 2.0.0, validado contra el XSD oficial y firmado
// con la firma sintética, con su clave compuesta con el tipo 07, una autorización fija y las
// denominaciones de sus documentos sustento tal como las congela el snapshot. Los valores retenidos
// son los que congelaría el cálculo único; aquí se escriben directamente porque el RIDE solo los
// transcribe.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WithholdingReceiptXmlSnapshot } from "../../src/modules/sri-engine/application/ports.ts";
import type {
  RideRenderInput,
  RideWithholdingLabels,
} from "../../src/modules/sri-engine/application/ride.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import { createWithholdingReceiptXmlBuilder } from "../../src/modules/sri-engine/infrastructure/withholding-receipt-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { FIXTURE_PASSWORD, readFixture } from "./p12-fixtures.ts";
import { BASE_ISSUER, authorizedAtOf } from "./ride-invoices.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const accessKeys = createAccessKeys();
const builder = createWithholdingReceiptXmlBuilder();
const signer = createXmlSigner();
const validator = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const schema = registeredSchema(
  (
    JSON.parse(
      readFileSync(path("../../src/modules/catalogs/datasets/schema-registry/2.json"), "utf8"),
    ) as { entries: (SchemaRegistryEntry & { documentType?: string; version?: string })[] }
  ).entries.map((entry) => ({
    ...entry,
    documentType: entry.documentType ?? null,
    version: entry.version ?? null,
    imports: entry.imports ?? [],
  })),
  "07",
  "2.0.0",
)!;

/** Denominaciones del snapshot: tabla 4 del Catálogo ATS, tabla 19 y catálogo `tax`. */
export const WITHHOLDING_LABELS: RideWithholdingLabels = {
  documentTypes: {
    "01": "Factura",
    "02": "Nota o boleta de venta",
    "03": "Liquidación de compra de Bienes o Prestación de servicios",
  },
  taxes: { "1": "RENTA", "2": "IVA" },
  supportTaxes: { "2": "IVA", "3": "ICE", "5": "IRBPNR" },
};

export type WithholdingSupport = WithholdingReceiptXmlSnapshot["supports"][number];

export type WithholdingCase = Readonly<{
  name: string;
  issueDate: string;
  sequential: string;
  supports: readonly WithholdingSupport[];
  /** Mutación del XML sin firmar, para probar un contenido que el builder no escribe. */
  tamper?: (xml: string) => string;
}>;

export type AuthorizedWithholding = Readonly<{
  name: string;
  accessKey: string;
  xml: Buffer;
  input: RideRenderInput;
}>;

export const supportTax = (
  taxCode: string,
  rateCode: string,
  tariff: string,
  base: string,
  amount: string,
) => ({ taxCode, rateCode, tariff, base, amount });

export const withheld = (
  taxCode: string,
  code: string,
  base: string,
  percentage: string,
  amount: string,
) => ({ taxCode, code, base, percentage, amount });

/**
 * Factura con IVA e ICE de la que se retiene renta (312) e IVA (código 2, 70 %), y una liquidación de
 * compra con IVA e IRBPNR de la que se retiene renta (303, 10 %).
 */
export const TWO_SUPPORTS: readonly WithholdingSupport[] = [
  {
    supportCode: "01",
    documentType: "01",
    number: "001001000000123",
    issueDate: "2026-10-01",
    authorizationNumber: "0110202601179123456700110010010000001231234567815",
    totalWithoutTaxes: "110.00",
    importTotal: "126.50",
    taxes: [
      supportTax("2", "4", "15", "110.00", "16.50"),
      supportTax("3", "3011", "10", "100.00", "10.00"),
    ],
    withholdings: [
      withheld("1", "312", "100.00", "1.75", "1.75"),
      withheld("2", "2", "16.50", "70", "11.55"),
    ],
    payments: [{ method: "20", total: "126.50" }],
  },
  {
    supportCode: "02",
    documentType: "03",
    number: "002005000004567",
    issueDate: "2026-09-28",
    authorizationNumber: null,
    totalWithoutTaxes: "1000.00",
    importTotal: "1150.02",
    taxes: [
      supportTax("2", "4", "15", "1000.00", "150.00"),
      supportTax("5", "5001", "0.02", "1", "0.02"),
    ],
    withholdings: [withheld("1", "303", "1000.00", "10", "100.00")],
    payments: [{ method: "01", total: "1150.02" }],
  },
];

export function withholdingSnapshot(receipt: WithholdingCase): WithholdingReceiptXmlSnapshot {
  const accessKey = accessKeys.compose({
    issueDate: receipt.issueDate,
    documentType: "07",
    ruc: BASE_ISSUER.ruc,
    environment: "1",
    establishment: BASE_ISSUER.establishment,
    emissionPoint: BASE_ISSUER.emissionPoint,
    sequential: receipt.sequential,
    numericCode: String((Number(receipt.sequential) * 7919) % 100_000_000).padStart(8, "0"),
  });
  return {
    schemaVersion: "2.0.0",
    environment: "1",
    issueDate: receipt.issueDate,
    accessKey,
    sequential: receipt.sequential,
    issuer: BASE_ISSUER,
    subject: {
      identificationType: "04",
      identification: "1791234567001",
      legalName: "PROVEEDORA DEL SUR S.A.",
    },
    relatedParty: "NO",
    fiscalPeriod: "10/2026",
    supports: receipt.supports,
  };
}

/** XML del builder, validado contra el XSD y firmado: el XML autorizado de la retención. */
export async function authorizedWithholding(
  receipt: WithholdingCase,
  p12Dir: string,
): Promise<AuthorizedWithholding> {
  const snapshot = withholdingSnapshot(receipt);
  const built = builder.build(snapshot);
  if (!receipt.tamper) {
    const result = await validator.validate(built, schema);
    if (!("valid" in result) || result.valid !== true) {
      throw new Error(
        `la retención ${receipt.name} no valida contra el XSD: ${JSON.stringify(result)}`,
      );
    }
  }
  const signed = await signer.sign({
    xml: receipt.tamper ? receipt.tamper(built) : built,
    documentType: "07",
    p12: readFixture(p12Dir, "sd-utf8.modern.p12"),
    password: FIXTURE_PASSWORD,
  });
  const xml = Buffer.from(signed, "utf8");
  return {
    name: receipt.name,
    accessKey: snapshot.accessKey,
    xml,
    input: {
      xml,
      accessKey: snapshot.accessKey,
      authorization: {
        number: snapshot.accessKey,
        authorizedAt: authorizedAtOf(receipt.issueDate),
        environment: "TEST",
      },
      paymentLabels: {},
      withholdingLabels: WITHHOLDING_LABELS,
      logo: null,
    },
  };
}

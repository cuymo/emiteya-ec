// Liquidaciones de compra autorizadas para las pruebas del RIDE (add-purchase-settlements, design
// D19): el XML del builder `liquidacionCompra` 1.1.0, validado contra el XSD oficial y firmado con la
// firma sintética, con su clave compuesta con el tipo 03 y una autorización fija. Las denominaciones
// de las formas de pago llegan del snapshot, como en la factura.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PurchaseSettlementXmlSnapshot } from "../../src/modules/sri-engine/application/ports.ts";
import type { RideRenderInput } from "../../src/modules/sri-engine/application/ride.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import { createPurchaseSettlementXmlBuilder } from "../../src/modules/sri-engine/infrastructure/purchase-settlement-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { FIXTURE_PASSWORD, readFixture } from "./p12-fixtures.ts";
import { BASE_ISSUER, authorizedAtOf } from "./ride-invoices.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const accessKeys = createAccessKeys();
const builder = createPurchaseSettlementXmlBuilder();
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
  "03",
  "1.1.0",
)!;

/** Denominaciones oficiales de la tabla 24 que congela el snapshot de la liquidación. */
export const SETTLEMENT_PAYMENT_LABELS: Readonly<Record<string, string>> = {
  "01": "SIN UTILIZACION DEL SISTEMA FINANCIERO",
  "20": "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO",
};

export type SettlementLine = PurchaseSettlementXmlSnapshot["lines"][number];
export type SettlementPayment = PurchaseSettlementXmlSnapshot["payments"][number];

export type SettlementCase = Readonly<{
  name: string;
  issueDate: string;
  sequential: string;
  lines: readonly SettlementLine[];
  totals: PurchaseSettlementXmlSnapshot["totals"];
  payments: readonly SettlementPayment[];
  supplier?: PurchaseSettlementXmlSnapshot["supplier"];
  /** Mutación del XML sin firmar, para probar un contenido que el builder no escribe. */
  tamper?: (xml: string) => string;
}>;

export type AuthorizedSettlement = Readonly<{
  name: string;
  accessKey: string;
  xml: Buffer;
  input: RideRenderInput;
}>;

export const iva = (rateCode: string, rate: string, base: string, amount: string) => ({
  taxCode: "2",
  rateCode,
  rate,
  base,
  amount,
});

/**
 * Dos líneas, una al 15 % con su unidad y su descuento y otra al 0 % con su código, y dos pagos:
 * uno de contado y otro a 30 días.
 */
export const TWO_LINES: Pick<SettlementCase, "lines" | "totals" | "payments"> = {
  lines: [
    {
      mainCode: "CAC-01",
      auxiliaryCode: "GR-45",
      description: "Saco de cacao en grano, 45 kg",
      unit: "saco",
      quantity: "10",
      unitPrice: "4.5",
      discount: "5.00",
      taxableBase: "40.00",
      tax: iva("4", "15", "40.00", "6.00"),
    },
    {
      mainCode: "JOR-01",
      auxiliaryCode: null,
      description: "Jornal de cosecha",
      unit: null,
      quantity: "2",
      unitPrice: "30",
      discount: "0.00",
      taxableBase: "60.00",
      tax: iva("0", "0", "60.00", "0.00"),
    },
  ],
  totals: {
    withoutTaxes: "100.00",
    discount: "5.00",
    taxes: [iva("0", "0", "60.00", "0.00"), iva("4", "15", "40.00", "6.00")],
    total: "106.00",
  },
  payments: [
    { method: "01", total: "50.00", term: "0", timeUnit: "días" },
    { method: "20", total: "56.00", term: "30", timeUnit: "días" },
  ],
};

export const SUPPLIER: PurchaseSettlementXmlSnapshot["supplier"] = {
  identificationType: "05",
  identification: "0102030405",
  legalName: "María Quishpe",
  address: "Comunidad San Pablo, Cayambe",
};

export function settlementSnapshot(settlement: SettlementCase): PurchaseSettlementXmlSnapshot {
  const accessKey = accessKeys.compose({
    issueDate: settlement.issueDate,
    documentType: "03",
    ruc: BASE_ISSUER.ruc,
    environment: "1",
    establishment: BASE_ISSUER.establishment,
    emissionPoint: BASE_ISSUER.emissionPoint,
    sequential: settlement.sequential,
    numericCode: String((Number(settlement.sequential) * 7919) % 100_000_000).padStart(8, "0"),
  });
  return {
    schemaVersion: "1.1.0",
    environment: "1",
    issueDate: settlement.issueDate,
    accessKey,
    sequential: settlement.sequential,
    issuer: BASE_ISSUER,
    supplier: settlement.supplier ?? SUPPLIER,
    lines: settlement.lines,
    totals: settlement.totals,
    currency: "DOLAR",
    payments: settlement.payments,
  };
}

/** XML del builder, validado contra el XSD y firmado: el XML autorizado de la liquidación. */
export async function authorizedSettlement(
  settlement: SettlementCase,
  p12Dir: string,
): Promise<AuthorizedSettlement> {
  const snapshot = settlementSnapshot(settlement);
  const built = builder.build(snapshot);
  if (!settlement.tamper) {
    const result = await validator.validate(built, schema);
    if (!("valid" in result) || result.valid !== true) {
      throw new Error(
        `la liquidación ${settlement.name} no valida contra el XSD: ${JSON.stringify(result)}`,
      );
    }
  }
  const signed = await signer.sign({
    xml: settlement.tamper ? settlement.tamper(built) : built,
    documentType: "03",
    p12: readFixture(p12Dir, "sd-utf8.modern.p12"),
    password: FIXTURE_PASSWORD,
  });
  const xml = Buffer.from(signed, "utf8");
  return {
    name: settlement.name,
    accessKey: snapshot.accessKey,
    xml,
    input: {
      xml,
      accessKey: snapshot.accessKey,
      authorization: {
        number: snapshot.accessKey,
        authorizedAt: authorizedAtOf(settlement.issueDate),
        environment: "TEST",
      },
      paymentLabels: SETTLEMENT_PAYMENT_LABELS,
      logo: null,
    },
  };
}

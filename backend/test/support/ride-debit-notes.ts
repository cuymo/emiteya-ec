// Notas de débito autorizadas para las pruebas del RIDE (add-debit-notes, design D18): el XML del
// builder `notaDebito` 1.0.0, validado contra el XSD oficial y firmado con la firma sintética, con su
// clave compuesta con el tipo 05, una autorización fija y la denominación de su forma de pago tal
// como la congela el snapshot. Los importes son los que congelaría el cálculo único; aquí se
// escriben directamente porque el RIDE solo los transcribe.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DebitNoteXmlSnapshot } from "../../src/modules/sri-engine/application/ports.ts";
import type { RideRenderInput } from "../../src/modules/sri-engine/application/ride.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createDebitNoteXmlBuilder } from "../../src/modules/sri-engine/infrastructure/debit-note-xml-builder.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { FIXTURE_PASSWORD, readFixture } from "./p12-fixtures.ts";
import { BASE_ISSUER, COMPANY_BUYER, authorizedAtOf } from "./ride-invoices.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const accessKeys = createAccessKeys();
const builder = createDebitNoteXmlBuilder();
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
  "05",
  "1.0.0",
)!;

/** Denominación de la forma de pago del snapshot (catálogo `payment-method`, entrada 20). */
export const PAYMENT_LABEL = "OTROS CON UTILIZACIÓN DEL SISTEMA FINANCIERO";

export type DebitNoteCase = Readonly<{
  name: string;
  issueDate: string;
  sequential: string;
  /** Mutación del XML sin firmar, para probar un contenido que el builder no escribe. */
  tamper?: (xml: string) => string;
  snapshot?: Partial<DebitNoteXmlSnapshot>;
}>;

export type AuthorizedDebitNote = Readonly<{
  name: string;
  accessKey: string;
  xml: Buffer;
  input: RideRenderInput;
}>;

/** Intereses de mora al 15 % y un flete posterior al 0 % sobre la factura 001-001-000000041. */
export function debitNoteSnapshot(note: DebitNoteCase): DebitNoteXmlSnapshot {
  const accessKey = accessKeys.compose({
    issueDate: note.issueDate,
    documentType: "05",
    ruc: BASE_ISSUER.ruc,
    environment: "1",
    establishment: BASE_ISSUER.establishment,
    emissionPoint: BASE_ISSUER.emissionPoint,
    sequential: note.sequential,
    numericCode: String((Number(note.sequential) * 7919) % 100_000_000).padStart(8, "0"),
  });
  return {
    schemaVersion: "1.0.0",
    environment: "1",
    issueDate: note.issueDate,
    accessKey,
    sequential: note.sequential,
    issuer: BASE_ISSUER,
    buyer: {
      identificationType: COMPANY_BUYER.identificationType,
      identification: COMPANY_BUYER.identification,
      legalName: COMPANY_BUYER.legalName,
    },
    modified: { documentType: "01", documentNumber: "001-001-000000041", issueDate: "2026-09-01" },
    withoutTaxes: "70.00",
    taxes: [
      { taxCode: "2", rateCode: "0", rate: "0", base: "20.00", amount: "0.00" },
      { taxCode: "2", rateCode: "4", rate: "15", base: "50.00", amount: "7.50" },
    ],
    total: "77.50",
    payment: { method: "20", total: "77.50" },
    reasons: [
      { reason: "Intereses por 30 días de mora", value: "50.00" },
      { reason: "Flete posterior a la venta", value: "20.00" },
    ],
    ...note.snapshot,
  };
}

/** XML del builder, validado contra el XSD y firmado: el XML autorizado de la nota. */
export async function authorizedDebitNote(
  note: DebitNoteCase,
  p12Dir: string,
): Promise<AuthorizedDebitNote> {
  const snapshot = debitNoteSnapshot(note);
  const built = builder.build(snapshot);
  if (!note.tamper) {
    const result = await validator.validate(built, schema);
    if (!("valid" in result) || result.valid !== true) {
      throw new Error(`la nota ${note.name} no valida contra el XSD: ${JSON.stringify(result)}`);
    }
  }
  const signed = await signer.sign({
    xml: note.tamper ? note.tamper(built) : built,
    documentType: "05",
    p12: readFixture(p12Dir, "sd-utf8.modern.p12"),
    password: FIXTURE_PASSWORD,
  });
  const xml = Buffer.from(signed, "utf8");
  return {
    name: note.name,
    accessKey: snapshot.accessKey,
    xml,
    input: {
      xml,
      accessKey: snapshot.accessKey,
      authorization: {
        number: snapshot.accessKey,
        authorizedAt: authorizedAtOf(note.issueDate),
        environment: "TEST",
      },
      paymentLabels: { [snapshot.payment.method]: PAYMENT_LABEL },
      logo: null,
    },
  };
}

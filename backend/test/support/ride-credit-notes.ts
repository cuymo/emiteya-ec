// Notas de crédito autorizadas para las pruebas del RIDE (add-credit-notes, design D14): el XML del
// builder `notaCredito` 1.1.0, validado contra el XSD oficial y firmado con la firma sintética, con
// su clave compuesta con el tipo 04 y una autorización fija. Los importes son los que congelaría el
// cálculo único; aquí se escriben directamente porque el RIDE solo los transcribe.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CreditNoteXmlSnapshot } from "../../src/modules/sri-engine/application/ports.ts";
import type { RideRenderInput } from "../../src/modules/sri-engine/application/ride.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createCreditNoteXmlBuilder } from "../../src/modules/sri-engine/infrastructure/credit-note-xml-builder.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { FIXTURE_PASSWORD, readFixture } from "./p12-fixtures.ts";
import { BASE_ISSUER, COMPANY_BUYER, authorizedAtOf } from "./ride-invoices.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const accessKeys = createAccessKeys();
const builder = createCreditNoteXmlBuilder();
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
  "04",
  "1.1.0",
)!;

export type CreditNoteCase = Readonly<{
  name: string;
  issueDate: string;
  sequential: string;
  /** Mutación del XML sin firmar, para probar un contenido que el builder no escribe. */
  tamper?: (xml: string) => string;
  snapshot?: Partial<CreditNoteXmlSnapshot>;
}>;

export type AuthorizedCreditNote = Readonly<{
  name: string;
  accessKey: string;
  xml: Buffer;
  input: RideRenderInput;
}>;

/** Devolución de dos líneas (IVA 15 % y 0 %) de la factura 001-001-000000041. */
export function creditNoteSnapshot(note: CreditNoteCase): CreditNoteXmlSnapshot {
  const accessKey = accessKeys.compose({
    issueDate: note.issueDate,
    documentType: "04",
    ruc: BASE_ISSUER.ruc,
    environment: "1",
    establishment: BASE_ISSUER.establishment,
    emissionPoint: BASE_ISSUER.emissionPoint,
    sequential: note.sequential,
    numericCode: String((Number(note.sequential) * 7919) % 100_000_000).padStart(8, "0"),
  });
  return {
    schemaVersion: "1.1.0",
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
    modified: { documentType: "01", documentNumber: "001-001-000000041", issueDate: "2026-10-01" },
    lines: [
      {
        mainCode: "CEM-50",
        auxiliaryCode: "7861234500017",
        description: "Cemento 50 kg",
        quantity: "2",
        unitPrice: "8.75",
        discount: "0.50",
        taxableBase: "17.00",
        taxes: [{ taxCode: "2", rateCode: "4", rate: "15", base: "17.00", amount: "2.55" }],
      },
      {
        mainCode: "LIB-01",
        auxiliaryCode: null,
        description: "Libro técnico",
        quantity: "1",
        unitPrice: "20.00",
        discount: "0.00",
        taxableBase: "20.00",
        taxes: [{ taxCode: "2", rateCode: "0", rate: "0", base: "20.00", amount: "0.00" }],
      },
    ],
    totals: {
      withoutTaxes: "37.00",
      taxes: [
        { taxCode: "2", rateCode: "0", base: "20.00", amount: "0.00" },
        { taxCode: "2", rateCode: "4", base: "17.00", amount: "2.55" },
      ],
      total: "39.55",
    },
    reason: "Devolución de mercadería en mal estado",
    ...note.snapshot,
  };
}

/** XML del builder, validado contra el XSD y firmado: el XML autorizado de la nota. */
export async function authorizedCreditNote(
  note: CreditNoteCase,
  p12Dir: string,
): Promise<AuthorizedCreditNote> {
  const snapshot = creditNoteSnapshot(note);
  const built = builder.build(snapshot);
  if (!note.tamper) {
    const result = await validator.validate(built, schema);
    if (!("valid" in result) || result.valid !== true) {
      throw new Error(`la nota ${note.name} no valida contra el XSD: ${JSON.stringify(result)}`);
    }
  }
  const signed = await signer.sign({
    xml: note.tamper ? note.tamper(built) : built,
    documentType: "04",
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
      paymentLabels: {},
      logo: null,
    },
  };
}

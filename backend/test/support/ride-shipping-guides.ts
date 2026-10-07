// Guías de remisión autorizadas para las pruebas del RIDE (add-shipping-guides, design D20): el XML
// del builder `guiaRemision` 1.1.0, validado contra el XSD oficial y firmado con la firma sintética,
// con su clave compuesta con el tipo 06 y una autorización fija. Todo sale del XML: el RIDE de la
// guía no necesita denominaciones del snapshot.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ShippingGuideXmlSnapshot } from "../../src/modules/sri-engine/application/ports.ts";
import type { RideRenderInput } from "../../src/modules/sri-engine/application/ride.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import { createShippingGuideXmlBuilder } from "../../src/modules/sri-engine/infrastructure/shipping-guide-xml-builder.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { FIXTURE_PASSWORD, readFixture } from "./p12-fixtures.ts";
import { BASE_ISSUER, authorizedAtOf } from "./ride-invoices.ts";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const accessKeys = createAccessKeys();
const builder = createShippingGuideXmlBuilder();
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
  "06",
  "1.1.0",
)!;

export type GuideRecipient = ShippingGuideXmlSnapshot["recipients"][number];

export type GuideCase = Readonly<{
  name: string;
  issueDate: string;
  sequential: string;
  recipients: readonly GuideRecipient[];
  /** Mutación del XML sin firmar, para probar un contenido que el builder no escribe. */
  tamper?: (xml: string) => string;
}>;

export type AuthorizedGuide = Readonly<{
  name: string;
  accessKey: string;
  xml: Buffer;
  input: RideRenderInput;
}>;

export const detail = (
  description: string,
  quantity: string,
  mainCode: string | null = null,
  auxiliaryCode: string | null = null,
) => ({ mainCode, auxiliaryCode, description, quantity });

/**
 * Tres destinatarios: el comprador con su factura sustento, un tercero en consignación con su ruta y
 * el código de su establecimiento de destino, y la propia empresa en un traslado entre sus
 * establecimientos.
 */
export const THREE_RECIPIENTS: readonly GuideRecipient[] = [
  {
    identification: "0992877878001",
    legalName: "FERRETERIA EL PERNO CIA. LTDA.",
    address: "Av. Quito y Guayaquil, Guayaquil",
    motive: "Venta",
    destinationEstablishmentCode: null,
    route: "Quito - Guayaquil",
    support: {
      documentType: "01",
      documentNumber: "001-001-000000123",
      authorizationNumber: "0510202601179001234500110010010000001231234567815",
      issueDate: "2026-10-05",
    },
    details: [
      detail("Cemento 50 kg en sacos", "10", "CEM-50", "AUX-1"),
      detail("Varilla corrugada 12 mm", "2.5", "VAR-12"),
    ],
  },
  {
    identification: "1710034065",
    legalName: "María Pérez",
    address: "Calle Sucre 12, Cayambe",
    motive: "Consignación",
    destinationEstablishmentCode: "003",
    route: "Quito - Cayambe",
    support: null,
    details: [detail("Arena fina, 3 metros cúbicos", "3.125000")],
  },
  {
    identification: "1790012345001",
    legalName: "COMERCIAL ANDINA S.A.",
    address: "Bodega sur, Av. Maldonado S34, Quito",
    motive: "Reposición de bodega",
    destinationEstablishmentCode: "002",
    route: null,
    support: null,
    details: [detail("Cemento 50 kg en sacos", "100", "CEM-50")],
  },
];

export function guideSnapshot(guide: GuideCase): ShippingGuideXmlSnapshot {
  const accessKey = accessKeys.compose({
    issueDate: guide.issueDate,
    documentType: "06",
    ruc: BASE_ISSUER.ruc,
    environment: "1",
    establishment: BASE_ISSUER.establishment,
    emissionPoint: BASE_ISSUER.emissionPoint,
    sequential: guide.sequential,
    numericCode: String((Number(guide.sequential) * 7919) % 100_000_000).padStart(8, "0"),
  });
  return {
    schemaVersion: "1.1.0",
    environment: "1",
    accessKey,
    sequential: guide.sequential,
    issuer: BASE_ISSUER,
    departureAddress: "Av. Amazonas N24-03, Quito",
    carrier: {
      identificationType: "04",
      identification: "1791111111001",
      legalName: "TRANSPORTES ANDINOS S.A.",
    },
    transportStart: guide.issueDate,
    transportEnd: "2026-10-08",
    plate: "PAA-1234",
    recipients: guide.recipients,
  };
}

/** XML del builder, validado contra el XSD y firmado: el XML autorizado de la guía. */
export async function authorizedGuide(guide: GuideCase, p12Dir: string): Promise<AuthorizedGuide> {
  const snapshot = guideSnapshot(guide);
  const built = builder.build(snapshot);
  if (!guide.tamper) {
    const result = await validator.validate(built, schema);
    if (!("valid" in result) || result.valid !== true) {
      throw new Error(`la guía ${guide.name} no valida contra el XSD: ${JSON.stringify(result)}`);
    }
  }
  const signed = await signer.sign({
    xml: guide.tamper ? guide.tamper(built) : built,
    documentType: "06",
    p12: readFixture(p12Dir, "sd-utf8.modern.p12"),
    password: FIXTURE_PASSWORD,
  });
  const xml = Buffer.from(signed, "utf8");
  return {
    name: guide.name,
    accessKey: snapshot.accessKey,
    xml,
    input: {
      xml,
      accessKey: snapshot.accessKey,
      authorization: {
        number: snapshot.accessKey,
        authorizedAt: authorizedAtOf(guide.issueDate),
        environment: "TEST",
      },
      paymentLabels: {},
      logo: null,
    },
  };
}

// Snapshot de la guía de remisión (add-shipping-guides, tarea 4.2, design D11 y D14): guarda el
// transportista con su origen, la partida con su establecimiento de origen, los dos establecimientos
// de un traslado propio con su identidad, cada destinatario con su sustento y su detalle, la
// declaración por destinatario y las cantidades canónicas; no depende de nada después de construido.
import { describe, expect, it } from "vitest";
import {
  buildShippingGuideSnapshot,
  type IssuerConfig,
  type IssuerPoint,
} from "../../src/modules/shipping-guides/domain/build-snapshot.ts";
import {
  evaluateShippingGuide,
  type GuideEstablishment,
  type GuideInvoice,
  type GuideParty,
} from "../../src/modules/shipping-guides/domain/evaluation.ts";
import { withShippingGuideKey } from "../../src/modules/shipping-guides/domain/snapshot.ts";

const config: IssuerConfig = {
  versionId: "cfg-1",
  version: 3,
  environment: "TEST",
  profile: {
    ruc: "1790000000001",
    legalName: "Distribuidora Nacional S.A.",
    tradeName: null,
    headOfficeAddress: "Matriz",
    accountingRequired: true,
    specialTaxpayerNumber: null,
    withholdingAgentResolution: null,
    rimpeCategory: null,
  },
};
const point: IssuerPoint = {
  point: { id: "pto-3", code: "001" },
  establishment: { id: "est-3", code: "003", address: "Dirección 003" },
};
const schema = {
  documentType: "06" as const,
  version: "1.1.0",
  path: "sri-xsd/GuiaRemision_V1.1.0.xsd",
  sha256: "4777fd94b5f7b108da3db0dd3d2c71d1539ced221cba246ebeaa40fb17f3dee1",
  imports: [],
};

function resolved() {
  const parties = new Map<string, GuideParty>([
    [
      "p-1",
      {
        id: "p-1",
        status: "ACTIVE",
        identificationType: "04",
        identification: "1790012345001",
        legalName: "Comercial Andina S.A.",
        address: "Av. Amazonas",
        roles: [],
        consumerFinal: false,
      },
    ],
  ]);
  const establishments = new Map<string, GuideEstablishment>([
    ["est-1", { id: "est-1", code: "001", address: "Dirección 001", active: true }],
    ["est-2", { id: "est-2", code: "002", address: "Dirección 002", active: true }],
  ]);
  const invoice: GuideInvoice = {
    id: "inv-1",
    documentType: "01",
    documentNumber: "001-001-000000123",
    issueDate: "2026-10-05",
    accessKey: "5".repeat(49),
    environment: "TEST",
    state: "AUTHORIZED",
    authorization: {
      number: "5".repeat(49),
      date: new Date("2026-10-05T15:00:00Z"),
      environment: "TEST",
    },
    intact: true,
  };
  const evaluation = evaluateShippingGuide({
    issueDate: "2026-10-06",
    environment: "TEST",
    draft: {
      originEstablishmentId: "est-1",
      departureAddress: null,
      transporter: { source: "SELF" },
      plate: "PAA-1234",
      transportStart: "2026-10-06",
      transportEnd: "2026-10-07",
      recipients: [
        {
          recipient: { kind: "PARTY", partyId: "p-1" },
          address: "Av. Simón Bolívar",
          motive: "Venta",
          route: "Quito - Cayambe",
          destinationEstablishmentCode: null,
          support: { kind: "INTERNAL_INVOICE", invoiceId: "inv-1" },
          details: [
            {
              productId: null,
              mainCode: null,
              auxiliaryCode: null,
              description: "Cemento",
              quantity: "2.500",
            },
          ],
        },
        {
          recipient: { kind: "OWN_COMPANY", destinationEstablishmentId: "est-2" },
          address: null,
          motive: "Reposición",
          route: null,
          destinationEstablishmentCode: null,
          support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
          details: [
            {
              productId: null,
              mainCode: "X-1",
              auxiliaryCode: null,
              description: "Varilla",
              quantity: "10.000000",
            },
          ],
        },
      ],
    },
    company: { ruc: "1790000000001", legalName: "Distribuidora Nacional S.A." },
    parties,
    establishments,
    products: new Map(),
    invoices: new Map([["inv-1", invoice]]),
    limits: { recipients: 10, detailsPerRecipient: 50, details: 100 },
  });
  expect(evaluation.issues).toEqual([]);
  return { guide: evaluation.guide!, establishments, parties };
}

const declaration = {
  policyVersion: 1,
  by: "user-1",
  byName: "Ana Operadora",
  at: new Date("2026-10-06T14:30:00Z"),
};

describe("snapshot de la guía de remisión", () => {
  it("guarda transportista, partida, establecimientos, destinatarios, sustentos, declaraciones y cantidades canónicas", () => {
    const { guide } = resolved();
    const snapshot = withShippingGuideKey(
      buildShippingGuideSnapshot({
        guide,
        declaration,
        config,
        point,
        schema,
        builderVersion: "1",
        datasetVersions: { "schema-registry": 2, "iva-rate": 4 },
        issueDate: "2026-10-06",
      }),
      {
        documentNumber: "003-001-000000001",
        sequential: "000000001",
        numericCode: "12345678",
        emissionType: "1",
        accessKey: "0".repeat(49),
      },
    );
    expect(snapshot).toMatchObject({
      snapshotVersion: 1,
      catalogDatasets: { "schema-registry": 2 },
      issuer: { establishment: { code: "003" } },
      departure: {
        source: "ESTABLISHMENT",
        establishment: { id: "est-1", code: "001" },
        address: "Dirección 001",
      },
      transporter: {
        source: "SELF",
        partyId: null,
        identificationType: "04",
        identification: "1790000000001",
      },
      plate: "PAA-1234",
      counts: { recipients: 2, details: 2 },
    });
    expect(snapshot.recipients[0]).toMatchObject({
      kind: "PARTY",
      route: "Quito - Cayambe",
      support: {
        kind: "INTERNAL_INVOICE",
        invoice: {
          id: "inv-1",
          documentType: "01",
          documentNumber: "001-001-000000123",
          authorization: { number: "5".repeat(49), environment: "TEST" },
        },
      },
      details: [{ quantity: "2.5" }],
    });
    expect(snapshot.recipients[1]).toMatchObject({
      kind: "OWN_COMPANY",
      destination: { id: "est-2", code: "002", address: "Dirección 002" },
      destinationEstablishmentCode: "002",
      support: {
        kind: "DECLARED_EXCEPTION",
        declaration: {
          case: "OWN_ESTABLISHMENT_TRANSFER",
          literal: "d",
          policyVersion: 1,
          basis: "USER_DECLARED",
          declaredBy: "user-1",
          declaredByName: "Ana Operadora",
          declaredAt: "2026-10-06T14:30:00.000Z",
        },
      },
      details: [{ quantity: "10" }],
    });
    // El snapshot no tiene total monetario ni precios.
    expect(JSON.stringify(snapshot)).not.toMatch(/total|precio|price/i);
  });

  it("no se construye una excepción sin la declaración del usuario", () => {
    const { guide } = resolved();
    expect(() =>
      buildShippingGuideSnapshot({
        guide,
        declaration: null,
        config,
        point,
        schema,
        builderVersion: "1",
        datasetVersions: {},
        issueDate: "2026-10-06",
      }),
    ).toThrow(/declaración del usuario/);
  });

  it("no depende de las lecturas después de construido", () => {
    const { guide, establishments, parties } = resolved();
    const snapshot = buildShippingGuideSnapshot({
      guide,
      declaration,
      config,
      point,
      schema,
      builderVersion: "1",
      datasetVersions: {},
      issueDate: "2026-10-06",
    });
    const before = JSON.stringify(snapshot);
    // Corregir después el establecimiento o el tercero leídos no cambia lo congelado.
    Object.assign(establishments.get("est-2")!, { address: "Otra dirección" });
    Object.assign(parties.get("p-1")!, { legalName: "Otro nombre" });
    Object.assign(guide.departure.establishment!, { address: "Cambiada" });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

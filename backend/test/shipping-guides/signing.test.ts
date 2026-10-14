// Firma de una guía de remisión con la firma compartida y su perfil (add-shipping-guides, tarea 5.2,
// design D2 y D16): el firmador vigente con el tipo 06, la validación XSD antes y después de firmar,
// el XML firmado con la clave de la guía y el certificado de la empresa, y el artefacto que declara el
// tipo 06. El snapshot sale del dominio (evaluación y construcción); el comprobante y los artefactos
// son dobles en memoria; el firmador y el validador son los reales. La factura, las notas y la
// retención no cambian: este perfil no los firma.
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";
import type { AuditEventInput } from "../../src/modules/audit/domain/audit-event.ts";
import { createSigningPipeline } from "../../src/modules/fiscal/application/signing-pipeline.ts";
import type {
  ArtifactStore,
  DocumentRepository,
  NewArtifact,
  StoredDocument,
} from "../../src/modules/fiscal/application/ports.ts";
import { shippingGuideSigningProfile } from "../../src/modules/shipping-guides/application/signing-profile.ts";
import { buildShippingGuideSnapshot } from "../../src/modules/shipping-guides/domain/build-snapshot.ts";
import { evaluateShippingGuide } from "../../src/modules/shipping-guides/domain/evaluation.ts";
import {
  withShippingGuideKey,
  type ShippingGuideSnapshot,
} from "../../src/modules/shipping-guides/domain/snapshot.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
import { createShippingGuideXmlBuilder } from "../../src/modules/sri-engine/infrastructure/shipping-guide-xml-builder.ts";
import {
  readEnvelopedSignature,
  verifyEnvelopedSignature,
} from "../../src/modules/sri-engine/infrastructure/signature-inspection.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import { FIXTURE_PASSWORD, readFixture } from "../support/p12-fixtures.ts";

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
const guiaRemision = registeredSchema(registry, "06", "1.1.0")!;
const xsd = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const dir = inject("p12FixturesDir");
const certificate = new X509Certificate(readFileSync(join(dir, "sd-utf8.crt")));
const xmlSigner = createXmlSigner();
const CTX = { userId: "u1", companyId: "c1", role: "OPERATOR" as const, requestId: "r1" };
const ACCESS_KEY = "0610202606179001234500110010010000000011234567811";
const ISSUE_DATE = "2026-10-06";

const evaluation = evaluateShippingGuide({
  issueDate: ISSUE_DATE,
  environment: "TEST",
  draft: {
    originEstablishmentId: null,
    departureAddress: "Bodega norte",
    transporter: { source: "SELF" },
    plate: "PAA-1234",
    transportStart: ISSUE_DATE,
    transportEnd: "2026-10-07",
    recipients: [
      {
        recipient: { kind: "PARTY", partyId: "p-1" },
        address: "Av. Simón Bolívar S/N",
        motive: "Consignación",
        route: null,
        destinationEstablishmentCode: null,
        support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
        details: [
          {
            productId: null,
            mainCode: null,
            auxiliaryCode: null,
            description: "Cemento 50 kg",
            quantity: "2.500",
          },
        ],
      },
    ],
  },
  company: { ruc: "1790012345001", legalName: "DISTRIBUIDORA NACIONAL S.A." },
  parties: new Map([
    [
      "p-1",
      {
        id: "p-1",
        status: "ACTIVE",
        identificationType: "05",
        identification: "0102030405",
        legalName: "María Pérez",
        address: null,
        roles: [],
        consumerFinal: false,
      },
    ],
  ]),
  establishments: new Map(),
  products: new Map(),
  invoices: new Map(),
  limits: { recipients: 10, detailsPerRecipient: 50, details: 100 },
});
const SNAPSHOT: ShippingGuideSnapshot = withShippingGuideKey(
  buildShippingGuideSnapshot({
    guide: evaluation.guide!,
    declaration: {
      policyVersion: 1,
      by: "u1",
      byName: "Ana",
      at: new Date("2026-10-06T15:00:00Z"),
    },
    config: {
      versionId: "v1",
      version: 1,
      environment: "TEST",
      profile: {
        ruc: "1790012345001",
        legalName: "DISTRIBUIDORA NACIONAL S.A.",
        tradeName: null,
        headOfficeAddress: "Av. Amazonas N24-03, Quito",
        accountingRequired: true,
        specialTaxpayerNumber: null,
        withholdingAgentResolution: null,
        rimpeCategory: null,
        largeTaxpayer: false,
        providerRuc: null,
      },
    },
    point: {
      point: { id: "p", code: "001" },
      establishment: { id: "e", code: "001", address: "Av. 6 de Diciembre N33-55, Quito" },
    },
    schema: {
      documentType: "06",
      version: "1.1.0",
      path: guiaRemision.path,
      sha256: guiaRemision.sha256,
      imports: guiaRemision.imports.map(({ path: file, sha256 }) => ({ path: file, sha256 })),
    },
    builderVersion: "1",
    datasetVersions: {},
    issueDate: ISSUE_DATE,
  }),
  {
    documentNumber: "001-001-000000001",
    sequential: "000000001",
    numericCode: "12345678",
    emissionType: "1",
    accessKey: ACCESS_KEY,
  },
);

const reserved = (documentType: "01" | "04" | "05" | "06" | "07" = "06"): StoredDocument => ({
  id: "gr-1",
  companyId: "c1",
  documentType,
  environment: "TEST",
  establishmentId: "e",
  emissionPointId: "p",
  documentNumber: "001-001-000000001",
  sequential: 1,
  reservationId: "r",
  accessKey: ACCESS_KEY,
  numericCode: "12345678",
  issueDate: ISSUE_DATE,
  state: "RESERVED",
  snapshot: SNAPSHOT,
  schemaVersion: "1.1.0",
  buyerIdentification: null,
  buyerName: null,
  total: null,
  createdAt: new Date(),
  createdBy: "u1",
  signedAt: null,
  lastAttempt: null,
  attemptCount: 0,
  attemptLeaseUntil: null,
  authorization: null,
});

function harness(document: StoredDocument) {
  let current = document;
  const saved: NewArtifact[] = [];
  const audit: AuditEventInput[] = [];
  const validated: string[] = [];
  const documentTypes: string[] = [];
  const documents: DocumentRepository = {
    insertReserved: () => Promise.reject(new Error("no se usa")),
    recordTransition: () => Promise.resolve(),
    find: () => Promise.resolve(current),
    lock: () => Promise.reject(new Error("no se usa")),
    advance: () => Promise.reject(new Error("no se usa")),
    list: () => Promise.reject(new Error("no se usa")),
    acquireAttemptLease: () => Promise.resolve(true),
    recordAttemptFailure: (_c, _d, diagnostic) => {
      current = { ...current, lastAttempt: diagnostic };
      return Promise.resolve();
    },
    markSigned: (_c, _d, signedAt) => {
      current = { ...current, state: "SIGNED", signedAt };
      return Promise.resolve(true);
    },
  };
  const artifacts: ArtifactStore = {
    save: (artifact) => {
      saved.push(artifact);
      return Promise.resolve({
        id: "a1",
        kind: artifact.kind,
        mediaType: artifact.mediaType,
        sha256: createHash("sha256").update(artifact.content).digest("hex"),
        sizeBytes: artifact.content.length,
        metadata: artifact.metadata,
        createdAt: new Date(),
      });
    },
    summary: () => Promise.resolve(null),
    read: () => Promise.resolve(null),
  };
  const pipeline = createSigningPipeline({
    documents,
    persist: {
      run: (work) =>
        work({
          artifacts,
          documents,
          audit: {
            append: (event) => {
              audit.push(event);
              return Promise.resolve();
            },
          },
          enqueueTransmission: () => Promise.resolve(true),
        }),
    },
    profile: shippingGuideSigningProfile(createShippingGuideXmlBuilder()),
    xsd: {
      validate: (xml, schema) => {
        validated.push(xml);
        return xsd.validate(xml, schema);
      },
    },
    signer: {
      async signDocument(_companyId, xml, documentType) {
        documentTypes.push(documentType);
        const signed = await xmlSigner.sign({
          xml,
          documentType,
          p12: readFixture(dir, "sd-utf8.modern.p12"),
          password: FIXTURE_PASSWORD,
        });
        return {
          xml: signed,
          certificateFingerprint: certificate.fingerprint256,
          certificateId: "cert-1",
        };
      },
    },
    signerVersion: "prueba",
  });
  return { pipeline, saved, audit, validated, documentTypes, current: () => current };
}

describe("firma de una guía de remisión (design D2 y D16)", () => {
  it("firma con el tipo 06, valida antes y después, y el artefacto declara el tipo 06", async () => {
    const h = harness(reserved());
    const result = await h.pipeline.continueToSigned(CTX, reserved());
    expect(result.state).toBe("SIGNED");
    expect(h.documentTypes).toEqual(["06"]);
    expect(h.validated).toHaveLength(2);
    expect(h.validated[0]).not.toContain("ds:Signature");
    expect(h.validated[1]).toContain("ds:Signature");

    const [artifact] = h.saved;
    const signed = artifact!.content.toString("utf8");
    expect(await xsd.validate(signed, guiaRemision)).toEqual({ valid: true });
    expect(signed).toContain(`<claveAcceso>${ACCESS_KEY}</claveAcceso>`);
    expect(signed).toContain("<codDoc>06</codDoc>");
    expect(signed).toContain("<cantidad>2.5</cantidad>");
    // La excepción declarada no tiene campo en el XML: ni el caso ni quién la declaró.
    expect(signed).not.toContain("USER_DECLARED");
    expect(signed).not.toContain("<codDocSustento>");
    const signature = readEnvelopedSignature(signed);
    expect(signature.certificate.fingerprint256).toBe(certificate.fingerprint256);
    expect(
      verifyEnvelopedSignature(
        signature,
        certificate.publicKey.export({ type: "spki", format: "pem" }) as string,
      ),
    ).toBe(true);
    expect(artifact!.metadata).toMatchObject({
      documentType: "06",
      schemaVersion: "1.1.0",
      schemaPath: "sri-xsd/GuiaRemision_V1.1.0.xsd",
      schemaSha256: guiaRemision.sha256,
      builderVersion: "1",
      certificateFingerprint: certificate.fingerprint256,
    });
    expect(h.audit.map((event) => [event.action, event.changes])).toEqual([
      [
        "shipping_guide.signed",
        {
          shippingGuideId: "gr-1",
          documentNumber: "001-001-000000001",
          artifactSha256: createHash("sha256").update(artifact!.content).digest("hex"),
        },
      ],
    ]);
  });

  it("un snapshot que no se puede escribir deja la guía RESERVED con su diagnóstico", async () => {
    const broken = { ...reserved(), snapshot: { ...SNAPSHOT, plate: "P".repeat(21) } };
    const h = harness(broken);
    const result = await h.pipeline.continueToSigned(CTX, broken);
    expect(result.state).toBe("RESERVED");
    expect(result.lastAttempt).toMatchObject({ stage: "BUILD_XML", code: "INVALID_SNAPSHOT_TEXT" });
    expect(h.documentTypes).toEqual([]);
  });

  it("el pipeline de la guía no firma una factura, una nota ni una retención", async () => {
    for (const documentType of ["01", "04", "05", "07"] as const) {
      const h = harness(reserved(documentType));
      await expect(h.pipeline.continueToSigned(CTX, reserved(documentType))).rejects.toThrow(
        /no es del tipo/,
      );
    }
  });
});

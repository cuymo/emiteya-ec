// Firma de una nota de crédito con la firma compartida y el perfil de la nota (add-credit-notes,
// tarea 4.2, design D2 y D12): el firmador vigente con el tipo 04, la validación XSD antes y después
// de firmar, el XML firmado con la clave de la nota y el certificado de la empresa, y el artefacto
// que declara el tipo 04. El comprobante y los artefactos son dobles en memoria; el firmador y el
// validador son los reales.
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";
import { creditNoteSigningProfile } from "../../src/modules/credit-notes/application/signing-profile.ts";
import type { CreditNoteSnapshot } from "../../src/modules/credit-notes/domain/snapshot.ts";
import { createSigningPipeline } from "../../src/modules/fiscal/application/signing-pipeline.ts";
import type {
  ArtifactStore,
  DocumentRepository,
  NewArtifact,
  StoredDocument,
} from "../../src/modules/fiscal/application/ports.ts";
import type { AuditEventInput } from "../../src/modules/audit/domain/audit-event.ts";
import {
  registeredSchema,
  type SchemaRegistryEntry,
} from "../../src/modules/sri-engine/application/schemas.ts";
import { createCreditNoteXmlBuilder } from "../../src/modules/sri-engine/infrastructure/credit-note-xml-builder.ts";
import { createXmlSigner } from "../../src/modules/sri-engine/infrastructure/ec-sri-signer.ts";
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
const notaCredito = registeredSchema(registry, "04", "1.1.0")!;
const xsd = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const dir = inject("p12FixturesDir");
const certificate = new X509Certificate(readFileSync(join(dir, "sd-utf8.crt")));
const xmlSigner = createXmlSigner();
const CTX = { userId: "u1", companyId: "c1", role: "OPERATOR" as const, requestId: "r1" };
const ACCESS_KEY = "0510202604179001234500110010010000000011234567814";

const SNAPSHOT: CreditNoteSnapshot = {
  snapshotVersion: 1,
  schema: {
    documentType: "04",
    version: "1.1.0",
    path: notaCredito.path,
    sha256: notaCredito.sha256,
    imports: notaCredito.imports.map(({ path: file, sha256 }) => ({ path: file, sha256 })),
  },
  builderVersion: "1",
  calculationVersion: 1,
  catalogDatasets: {},
  taxpayerConfig: { versionId: "v1", version: 1 },
  issueDate: "2026-10-05",
  environment: "TEST",
  environmentCode: "1",
  issuer: {
    ruc: "1790012345001",
    legalName: "COMERCIAL ANDINA S.A.",
    tradeName: null,
    headOfficeAddress: "Av. Amazonas N24-03, Quito",
    establishment: { id: "e", code: "001", address: "Av. 6 de Diciembre N33-55, Quito" },
    emissionPoint: { id: "p", code: "001" },
    accountingRequired: true,
    specialTaxpayerNumber: null,
    withholdingAgentResolution: null,
    rimpeCategory: null,
  },
  buyer: {
    identificationType: "04",
    identification: "0992877878001",
    legalName: "EL PERNO CIA. LTDA.",
    address: null,
  },
  cause: "RETURN",
  reason: "Devolución de una unidad",
  invoice: {
    id: "inv-1",
    documentType: "01",
    documentNumber: "001-001-000000041",
    issueDate: "2026-10-01",
    accessKey: "0110202601179001234500110010010000000411234567813",
    authorizationNumber: "0110202601179001234500110010010000000411234567813",
    authorizationDate: "2026-10-01T15:00:00.000Z",
    environment: "TEST",
    snapshotVersion: 2,
  },
  lines: [
    {
      position: 1,
      invoicePosition: 1,
      productId: "prod-1",
      mainCode: "CEM-50",
      auxiliaryCode: null,
      description: "Cemento 50 kg",
      quantity: "1",
      unitPrice: "10.00",
      subtotal: "10.00",
      discount: "1.00",
      taxableBase: "9.00",
      taxes: [
        {
          taxCode: "2",
          rateCode: "4",
          catalogType: "iva-rate",
          entryKey: "4",
          versionId: "4@1",
          officialLabel: "IVA 15 %",
          percentage: "15",
          base: "9.00",
          amount: "1.35",
        },
      ],
      physicalReturn: "1",
      inventoryAffectsStock: true,
    },
  ],
  totals: {
    withoutTaxes: "9.00",
    discount: "1.00",
    taxes: [{ taxCode: "2", rateCode: "4", percentage: "15", base: "9.00", amount: "1.35" }],
    total: "10.35",
  },
  declarations: {
    version: 1,
    statements: ["NOT_NEGOTIATED_COMMERCIAL_INVOICE", "NOT_TAX_REFUND_SUPPORT"],
    declaredBy: "u1",
    declaredAt: "2026-10-05T15:00:00.000Z",
    basis: "USER_DECLARED",
  },
  key: {
    documentNumber: "001-001-000000001",
    sequential: "000000001",
    numericCode: "12345678",
    emissionType: "1",
    accessKey: ACCESS_KEY,
  },
};

const reserved = (documentType: "01" | "04" = "04"): StoredDocument => ({
  id: "nc-1",
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
  issueDate: "2026-10-05",
  state: "RESERVED",
  snapshot: SNAPSHOT,
  schemaVersion: "1.1.0",
  buyerIdentification: "0992877878001",
  buyerName: "EL PERNO CIA. LTDA.",
  total: "10.35",
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
    profile: creditNoteSigningProfile(createCreditNoteXmlBuilder()),
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

describe("firma de una nota de crédito (design D2 y D12)", () => {
  it("firma con el tipo 04, valida antes y después, y el artefacto declara el tipo 04", async () => {
    const h = harness(reserved());
    const result = await h.pipeline.continueToSigned(CTX, reserved());
    expect(result.state).toBe("SIGNED");
    expect(h.documentTypes).toEqual(["04"]);

    // Validación XSD antes de firmar (el XML del builder) y después (el firmado).
    expect(h.validated).toHaveLength(2);
    expect(h.validated[0]).not.toContain("ds:Signature");
    expect(h.validated[1]).toContain("ds:Signature");

    const [artifact] = h.saved;
    const signed = artifact!.content.toString("utf8");
    expect(await xsd.validate(signed, notaCredito)).toEqual({ valid: true });
    expect(signed).toContain(`<claveAcceso>${ACCESS_KEY}</claveAcceso>`);
    expect(signed).toContain("<codDoc>04</codDoc>");
    expect(signed).not.toContain(SNAPSHOT.invoice.accessKey);
    const signature = readEnvelopedSignature(signed);
    expect(signature.certificate.fingerprint256).toBe(certificate.fingerprint256);
    expect(
      verifyEnvelopedSignature(
        signature,
        certificate.publicKey.export({ type: "spki", format: "pem" }) as string,
      ),
    ).toBe(true);
    expect(artifact!.metadata).toMatchObject({
      documentType: "04",
      schemaVersion: "1.1.0",
      schemaPath: "sri-xsd/NotaCredito_V1.1.0.xsd",
      schemaSha256: notaCredito.sha256,
      builderVersion: "1",
      certificateFingerprint: certificate.fingerprint256,
    });
    expect(h.audit.map((event) => [event.action, event.changes])).toEqual([
      [
        "credit_note.signed",
        {
          creditNoteId: "nc-1",
          documentNumber: "001-001-000000001",
          artifactSha256: createHash("sha256").update(artifact!.content).digest("hex"),
        },
      ],
    ]);
  });

  it("un snapshot que no se puede escribir deja la nota RESERVED con su diagnóstico", async () => {
    const broken = { ...reserved(), snapshot: { ...SNAPSHOT, reason: "Motivo \u0000" } };
    const h = harness(broken);
    const result = await h.pipeline.continueToSigned(CTX, broken);
    expect(result.state).toBe("RESERVED");
    expect(result.lastAttempt).toMatchObject({ stage: "BUILD_XML", code: "INVALID_SNAPSHOT_TEXT" });
    expect(h.documentTypes).toEqual([]);
  });

  it("el pipeline de la nota no firma una factura", async () => {
    const h = harness(reserved("01"));
    await expect(h.pipeline.continueToSigned(CTX, reserved("01"))).rejects.toThrow(
      /no es del tipo/,
    );
  });
});

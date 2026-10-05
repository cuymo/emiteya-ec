// Firma de una nota de débito con la firma compartida y el perfil de la nota (add-debit-notes, tarea
// 4.2, design D2 y D16): el firmador vigente con el tipo 05, la validación XSD antes y después de
// firmar, el XML firmado con la clave de la nota, su única forma de pago tomada del snapshot y el
// certificado de la empresa, y el artefacto que declara el tipo 05. El comprobante y los artefactos
// son dobles en memoria; el firmador y el validador son los reales.
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it } from "vitest";
import { debitNoteSigningProfile } from "../../src/modules/debit-notes/application/signing-profile.ts";
import type { DebitNoteSnapshot } from "../../src/modules/debit-notes/domain/snapshot.ts";
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
import { createDebitNoteXmlBuilder } from "../../src/modules/sri-engine/infrastructure/debit-note-xml-builder.ts";
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
const notaDebito = registeredSchema(registry, "05", "1.0.0")!;
const xsd = createXmllintXsdValidator({ root: path("../../../docs/product/") });
const dir = inject("p12FixturesDir");
const certificate = new X509Certificate(readFileSync(join(dir, "sd-utf8.crt")));
const xmlSigner = createXmlSigner();
const CTX = { userId: "u1", companyId: "c1", role: "OPERATOR" as const, requestId: "r1" };
const ACCESS_KEY = "0910202605179001234500110010010000000011234567811";
const INVOICE_KEY = "0109202601179001234500110010010000000411234567818";

const SNAPSHOT: DebitNoteSnapshot = {
  snapshotVersion: 1,
  schema: {
    documentType: "05",
    version: "1.0.0",
    path: notaDebito.path,
    sha256: notaDebito.sha256,
    imports: notaDebito.imports.map(({ path: file, sha256 }) => ({ path: file, sha256 })),
  },
  builderVersion: "1",
  calculationVersion: 1,
  catalogDatasets: {},
  taxpayerConfig: { versionId: "v1", version: 1 },
  issueDate: "2026-10-09",
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
  invoice: {
    id: "inv-1",
    documentType: "01",
    documentNumber: "001-001-000000041",
    issueDate: "2026-09-01",
    accessKey: INVOICE_KEY,
    authorizationNumber: INVOICE_KEY,
    authorizationDate: "2026-09-01T15:00:00.000Z",
    environment: "TEST",
    snapshotVersion: 2,
    taxTreatments: [
      {
        key: "2:4",
        taxCode: "2",
        rateCode: "4",
        percentage: "15",
        catalogType: "iva-rate",
        entryKey: "4",
        versionId: "4@1",
        officialLabel: "15%",
      },
    ],
  },
  concepts: [
    {
      position: 1,
      cause: "LATE_PAYMENT_INTEREST",
      description: "Intereses por 30 días de mora",
      amount: "100.00",
      taxTreatment: "2:4",
    },
  ],
  taxes: [{ taxCode: "2", rateCode: "4", percentage: "15", base: "100.00", amount: "15.00" }],
  totals: { withoutTaxes: "100.00", total: "115.00" },
  payments: [
    {
      position: 1,
      entryKey: "20",
      code: "20",
      catalogType: "payment-method",
      versionId: "20@1",
      datasetVersion: 1,
      officialLabel: "OTROS CON UTILIZACION DEL SISTEMA FINANCIERO",
      amount: "115.00",
    },
  ],
  declarations: {
    version: 1,
    statements: ["NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE"],
    declaredBy: "u1",
    declaredAt: "2026-10-09T15:00:00.000Z",
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

const reserved = (documentType: "01" | "04" | "05" = "05"): StoredDocument => ({
  id: "nd-1",
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
  issueDate: "2026-10-09",
  state: "RESERVED",
  snapshot: SNAPSHOT,
  schemaVersion: "1.0.0",
  buyerIdentification: "0992877878001",
  buyerName: "EL PERNO CIA. LTDA.",
  total: "115.00",
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
    profile: debitNoteSigningProfile(createDebitNoteXmlBuilder()),
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

describe("firma de una nota de débito (design D2 y D16)", () => {
  it("firma con el tipo 05, valida antes y después, y el artefacto declara el tipo 05", async () => {
    const h = harness(reserved());
    const result = await h.pipeline.continueToSigned(CTX, reserved());
    expect(result.state).toBe("SIGNED");
    expect(h.documentTypes).toEqual(["05"]);

    // Validación XSD antes de firmar (el XML del builder) y después (el firmado).
    expect(h.validated).toHaveLength(2);
    expect(h.validated[0]).not.toContain("ds:Signature");
    expect(h.validated[1]).toContain("ds:Signature");

    const [artifact] = h.saved;
    const signed = artifact!.content.toString("utf8");
    expect(await xsd.validate(signed, notaDebito)).toEqual({ valid: true });
    expect(signed).toContain(`<claveAcceso>${ACCESS_KEY}</claveAcceso>`);
    expect(signed).toContain("<codDoc>05</codDoc>");
    expect(signed).not.toContain(INVOICE_KEY);
    // La única forma de pago, del snapshot: código y total.
    expect(signed.replace(/>\s+</g, "><")).toContain(
      "<pagos><pago><formaPago>20</formaPago><total>115.00</total></pago></pagos>",
    );
    // La declaración del usuario no forma parte del comprobante.
    expect(signed).not.toContain("NOT_EFFECTIVELY_NEGOTIATED_COMMERCIAL_INVOICE");
    const signature = readEnvelopedSignature(signed);
    expect(signature.certificate.fingerprint256).toBe(certificate.fingerprint256);
    expect(
      verifyEnvelopedSignature(
        signature,
        certificate.publicKey.export({ type: "spki", format: "pem" }) as string,
      ),
    ).toBe(true);
    expect(artifact!.metadata).toMatchObject({
      documentType: "05",
      schemaVersion: "1.0.0",
      schemaPath: "sri-xsd/NotaDebito_V1.0.0.xsd",
      schemaSha256: notaDebito.sha256,
      builderVersion: "1",
      certificateFingerprint: certificate.fingerprint256,
    });
    expect(h.audit.map((event) => [event.action, event.changes])).toEqual([
      [
        "debit_note.signed",
        {
          debitNoteId: "nd-1",
          documentNumber: "001-001-000000001",
          artifactSha256: createHash("sha256").update(artifact!.content).digest("hex"),
        },
      ],
    ]);
  });

  it("un snapshot que no se puede escribir deja la nota RESERVED con su diagnóstico", async () => {
    const broken = {
      ...reserved(),
      snapshot: {
        ...SNAPSHOT,
        concepts: [{ ...SNAPSHOT.concepts[0]!, description: "Motivo \u0000" }],
      },
    };
    const h = harness(broken);
    const result = await h.pipeline.continueToSigned(CTX, broken);
    expect(result.state).toBe("RESERVED");
    expect(result.lastAttempt).toMatchObject({ stage: "BUILD_XML", code: "INVALID_SNAPSHOT_TEXT" });
    expect(h.documentTypes).toEqual([]);
  });

  it("el pipeline de la nota de débito no firma una factura ni una nota de crédito", async () => {
    for (const documentType of ["01", "04"] as const) {
      const h = harness(reserved(documentType));
      await expect(h.pipeline.continueToSigned(CTX, reserved(documentType))).rejects.toThrow(
        /no es del tipo/,
      );
    }
  });
});

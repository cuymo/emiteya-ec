// Procedimiento del snapshot al artefacto firmado (add-invoice-emission, tarea 9.2, design D9 y D10)
// con dobles en memoria: cada fallo de etapa queda como diagnóstico tipado con su clase, el
// comprobante sigue RESERVED y el arriendo se libera; el detalle de XSD_INVALID lleva solo la línea
// y el elemento, nunca el valor.
import { describe, expect, it } from "vitest";
import type {
  ArtifactStore,
  DocumentRepository,
  StoredDocument,
} from "../../src/modules/fiscal/application/ports.ts";
import type { AttemptDiagnostic } from "../../src/modules/fiscal/domain/document.ts";
import { createSigningPipeline } from "../../src/modules/invoices/application/signing-pipeline.ts";
import type { InvoiceSnapshotV1 } from "../../src/modules/invoices/domain/snapshot.ts";
import {
  XsdValidatorError,
  type XsdValidation,
} from "../../src/modules/sri-engine/application/ports.ts";
import { createInvoiceXmlBuilder } from "../../src/modules/sri-engine/infrastructure/invoice-xml-builder.ts";

const CTX = { userId: "u1", companyId: "c1", role: "OPERATOR" as const, requestId: "r1" };

const SNAPSHOT: InvoiceSnapshotV1 = {
  snapshotVersion: 1,
  schema: {
    documentType: "01",
    version: "1.1.0",
    path: "sri-xsd/factura_V1.1.0.xsd",
    sha256: "a".repeat(64),
    imports: [{ path: "w3c-xsd/xmldsig-core-schema.xsd", sha256: "b".repeat(64) }],
  },
  builderVersion: "1",
  catalogDatasets: {},
  taxpayerConfig: { versionId: "v1", version: 1 },
  issueDate: "2026-10-03",
  environment: "TEST",
  environmentCode: "1",
  issuer: {
    ruc: "1790012345001",
    legalName: "COMERCIAL ANDINA S.A.",
    tradeName: null,
    headOfficeAddress: "Quito",
    establishment: { id: "e", code: "001", address: "Quito" },
    emissionPoint: { id: "p", code: "001" },
    accountingRequired: true,
    specialTaxpayerNumber: null,
    withholdingAgentResolution: null,
    rimpeCategory: null,
    largeTaxpayer: false,
  },
  buyer: {
    partyId: "b",
    identificationType: "04",
    identification: "0992877878001",
    legalName: "EL PERNO",
    address: null,
    consumerFinal: false,
    consumerFinalPolicy: null,
  },
  lines: [
    {
      position: 1,
      productId: "x",
      mainCode: null,
      auxiliaryCode: null,
      description: "Servicio",
      quantity: "1",
      unitPrice: "10",
      discount: "0.00",
      subtotal: "10",
      taxableBase: "10.00",
      taxes: [
        {
          taxCode: "2",
          rateCode: "4",
          catalogType: "iva-rate",
          entryKey: "4",
          versionId: "4@1",
          officialLabel: "IVA 15 %",
          percentage: "15",
          base: "10.00",
          amount: "1.50",
        },
      ],
    },
  ],
  totals: {
    withoutTaxes: "10.00",
    discount: "0.00",
    taxes: [{ taxCode: "2", rateCode: "4", percentage: "15", base: "10.00", amount: "1.50" }],
    total: "11.50",
  },
  payments: [
    {
      position: 1,
      entryKey: "01",
      code: "01",
      versionId: "01@1",
      officialLabel: "Efectivo",
      amount: "11.50",
    },
  ],
  specialCases: { operation: [], issuerRules: [] },
  key: {
    documentNumber: "001-001-000000001",
    sequential: "000000001",
    numericCode: "12345678",
    emissionType: "1",
    accessKey: "0310202601179001234500110010010000000011234567816",
  },
};

function reserved(snapshot: InvoiceSnapshotV1 = SNAPSHOT): StoredDocument {
  return {
    id: "d1",
    companyId: "c1",
    documentType: "01",
    environment: "TEST",
    establishmentId: "e",
    emissionPointId: "p",
    documentNumber: "001-001-000000001",
    sequential: 1,
    reservationId: "r",
    accessKey: snapshot.key.accessKey,
    numericCode: "12345678",
    issueDate: "2026-10-03",
    state: "RESERVED",
    snapshot,
    schemaVersion: "1.1.0",
    buyerIdentification: "0992877878001",
    buyerName: "EL PERNO",
    total: "11.50",
    createdAt: new Date(),
    createdBy: "u1",
    signedAt: null,
    lastAttempt: null,
    attemptCount: 0,
    attemptLeaseUntil: null,
    authorization: null,
  };
}

/** Repositorio en memoria con la semántica del arriendo y de los intentos. */
function memoryDocuments(initial: StoredDocument) {
  let document = initial;
  const failures: AttemptDiagnostic[] = [];
  const repository: DocumentRepository = {
    insertReserved: () => Promise.reject(new Error("no se usa")),
    recordTransition: () => Promise.resolve(),
    find: () => Promise.resolve(document),
    lock: () => Promise.reject(new Error("no se usa")),
    advance: () => Promise.reject(new Error("no se usa")),
    list: () => Promise.reject(new Error("no se usa")),
    acquireAttemptLease(_c, _d, now, until) {
      if (document.state !== "RESERVED") return Promise.resolve(false);
      if (document.attemptLeaseUntil && document.attemptLeaseUntil >= now) {
        return Promise.resolve(false);
      }
      document = { ...document, attemptLeaseUntil: until };
      return Promise.resolve(true);
    },
    recordAttemptFailure(_c, _d, diagnostic) {
      failures.push(diagnostic);
      document = {
        ...document,
        lastAttempt: diagnostic,
        attemptCount: document.attemptCount + 1,
        attemptLeaseUntil: null,
      };
      return Promise.resolve();
    },
    markSigned(_c, _d, signedAt) {
      document = {
        ...document,
        state: "SIGNED",
        signedAt,
        attemptCount: document.attemptCount + 1,
        attemptLeaseUntil: null,
      };
      return Promise.resolve(true);
    },
  };
  return {
    repository,
    failures,
    current: () => document,
    set: (next: StoredDocument) => (document = next),
  };
}

const artifacts: ArtifactStore = {
  save: (artifact) =>
    Promise.resolve({
      id: "a1",
      kind: artifact.kind,
      mediaType: artifact.mediaType,
      sha256: "c".repeat(64),
      sizeBytes: artifact.content.length,
      metadata: artifact.metadata,
      createdAt: new Date(),
    }),
  summary: () => Promise.resolve(null),
  read: () => Promise.resolve(null),
};

const VALID: XsdValidation = { valid: true };

function pipelineWith(options: {
  document?: StoredDocument;
  validate?: (xml: string) => Promise<XsdValidation>;
  sign?: () => Promise<{ xml: string; certificateFingerprint: string; certificateId: string }>;
  persistFails?: boolean;
}) {
  const docs = memoryDocuments(options.document ?? reserved());
  const pipeline = createSigningPipeline({
    documents: docs.repository,
    persist: {
      run: (work) =>
        options.persistFails
          ? Promise.reject(new Error("conexión perdida"))
          : work({
              artifacts,
              documents: docs.repository,
              audit: { append: () => Promise.resolve() },
            }),
    },
    builder: createInvoiceXmlBuilder(),
    xsd: { validate: (xml) => (options.validate ?? (() => Promise.resolve(VALID)))(xml) },
    signer: {
      signDocument: (_c, xml) =>
        (
          options.sign ??
          (() =>
            Promise.resolve({
              xml: `${xml}<!--firmado-->`,
              certificateFingerprint: "f",
              certificateId: "c",
            }))
        )(),
    },
    signerVersion: "prueba",
  });
  return { docs, run: () => pipeline.continueToSigned(CTX, docs.current()) };
}

describe("procedimiento de firma (design D9 y D10)", () => {
  it("firma y deja SIGNED", async () => {
    const { run } = pipelineWith({});
    expect((await run()).state).toBe("SIGNED");
  });

  it("XSD_INVALID guarda solo la línea y el elemento, nunca el valor", async () => {
    const { run, docs } = pipelineWith({
      validate: () =>
        Promise.resolve({
          valid: false,
          violations: [
            {
              line: 12,
              message:
                "Element 'razonSocialComprador': 'EL PERNO SECRETO' is not a valid value of the atomic type.",
            },
          ],
        }),
    });
    const result = await run();
    expect(result).toMatchObject({ state: "RESERVED", attemptCount: 1, attemptLeaseUntil: null });
    expect(docs.failures[0]).toMatchObject({
      stage: "VALIDATE_XSD",
      code: "XSD_INVALID",
      class: "DETERMINISTIC_VALIDATION",
      detail: { line: 12, element: "razonSocialComprador" },
    });
    expect(JSON.stringify(docs.failures)).not.toContain("SECRETO");
  });

  it("el XML firmado inválido es SIGNED_XML_INVALID", async () => {
    let calls = 0;
    const { run, docs } = pipelineWith({
      validate: () =>
        Promise.resolve(
          ++calls === 1 ? VALID : { valid: false, violations: [{ line: null, message: "otro" }] },
        ),
    });
    await run();
    expect(docs.failures[0]).toMatchObject({
      stage: "VALIDATE_SIGNED_XSD",
      code: "SIGNED_XML_INVALID",
      detail: { line: null, element: null },
    });
  });

  it("cada error del validador se traduce a su código y clase", async () => {
    for (const [code, expected, kind] of [
      ["VALIDATOR_BUSY", "VALIDATOR_BUSY", "RETRYABLE_OPERATIONAL"],
      ["VALIDATOR_TIMEOUT", "VALIDATOR_TIMEOUT", "RETRYABLE_OPERATIONAL"],
      ["SCHEMA_HASH_MISMATCH", "SCHEMA_HASH_MISMATCH", "DETERMINISTIC_CONFIGURATION"],
      ["SCHEMA_UNAVAILABLE", "SCHEMA_UNAVAILABLE", "DETERMINISTIC_CONFIGURATION"],
      ["VALIDATOR_FAILED", "SCHEMA_UNAVAILABLE", "DETERMINISTIC_CONFIGURATION"],
    ] as const) {
      const { run, docs } = pipelineWith({
        validate: () => Promise.reject(new XsdValidatorError(code)),
      });
      await run();
      expect(docs.failures[0], code).toMatchObject({ code: expected, class: kind });
    }
  });

  it("texto que XML no admite y versión de esquema desconocida", async () => {
    const text = pipelineWith({
      document: reserved({
        ...SNAPSHOT,
        buyer: { ...SNAPSHOT.buyer, legalName: "EL PERNO\u0001" },
      }),
    });
    await text.run();
    expect(text.docs.failures[0]).toMatchObject({
      stage: "BUILD_XML",
      code: "INVALID_SNAPSHOT_TEXT",
    });
    const version = pipelineWith({
      document: reserved({ ...SNAPSHOT, schema: { ...SNAPSHOT.schema, version: "2.1.0" } }),
    });
    await version.run();
    expect(version.docs.failures[0]).toMatchObject({ code: "SCHEMA_UNAVAILABLE" });
  });

  it("los fallos de la firma conservan su código; uno desconocido es CRYPTO_UNAVAILABLE", async () => {
    const coded = pipelineWith({
      sign: () => Promise.reject(Object.assign(new Error("x"), { code: "CERTIFICATE_MISMATCH" })),
    });
    await coded.run();
    expect(coded.docs.failures[0]).toMatchObject({
      stage: "SIGN",
      code: "CERTIFICATE_MISMATCH",
      class: "DETERMINISTIC_CONFIGURATION",
    });
    const unknown = pipelineWith({ sign: () => Promise.reject(new Error("worker caído")) });
    await unknown.run();
    expect(unknown.docs.failures[0]).toMatchObject({
      code: "CRYPTO_UNAVAILABLE",
      class: "RETRYABLE_OPERATIONAL",
    });
  });

  it("un fallo al guardar es PERSIST_FAILED reintentable y el comprobante sigue RESERVED", async () => {
    const { run, docs } = pipelineWith({ persistFails: true });
    expect((await run()).state).toBe("RESERVED");
    expect(docs.failures[0]).toMatchObject({
      stage: "PERSIST",
      code: "PERSIST_FAILED",
      class: "RETRYABLE_OPERATIONAL",
    });
  });

  it("con el arriendo de otro intento vigente no intenta; vencido, lo retoma", async () => {
    const leased = { ...reserved(), attemptLeaseUntil: new Date(Date.now() + 60_000) };
    const busy = pipelineWith({ document: leased });
    const result = await busy.run();
    expect(result).toMatchObject({ state: "RESERVED", attemptCount: 0 });
    expect(busy.docs.failures).toEqual([]);
    const expired = pipelineWith({
      document: { ...leased, attemptLeaseUntil: new Date(Date.now() - 1) },
    });
    expect((await expired.run()).state).toBe("SIGNED");
  });

  it("un comprobante firmado se devuelve sin intentar", async () => {
    const signed = { ...reserved(), state: "SIGNED" as const, signedAt: new Date() };
    const { run, docs } = pipelineWith({ document: signed });
    expect(await run()).toBe(signed);
    expect(docs.failures).toEqual([]);
  });
});

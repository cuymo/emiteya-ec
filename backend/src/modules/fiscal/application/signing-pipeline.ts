// Del snapshot al artefacto firmado (add-invoice-emission, design D9 y D10), después del commit de
// la reserva y fuera de toda transacción larga: arriendo del intento, XML desde el snapshot, XSD,
// firma con la firma vigente, XSD del XML firmado y, en una transacción, el artefacto exacto con el
// paso a SIGNED, su transición y la auditoría. Un fallo deja el comprobante RESERVED con el
// diagnóstico del último intento; nunca reintenta por su cuenta. Las etapas se miden como `xml`,
// `xsd` (antes y después de firmar), `sign` y `persist` (design D16).
//
// La orquestación es la misma para cada tipo (add-credit-notes, design D2): el esquema sale del
// snapshot y el tipo, del comprobante. Lo que difiere lo da el perfil del tipo, en interfaces
// pequeñas: el XML desde su snapshot y la auditoría del paso a SIGNED. Cada módulo crea su pipeline
// con su perfil; no hay un conmutador por `codDoc`.
import {
  SIGNING_ATTEMPT_CODES,
  type SigningAttemptCode,
  type SigningAttemptStage,
} from "@facturador/contracts";
import type { AuditAction, AuditChanges } from "../../audit/domain/audit-event.ts";
import { NO_TIMINGS, type StageTimings } from "../../../platform/metrics/stage-timings.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import {
  XsdValidatorError,
  type RegisteredSchema,
  type SchemaFile,
  type XsdValidation,
  type XsdValidator,
} from "../../sri-engine/application/ports.ts";
import type { AttemptDetail } from "../domain/document.ts";
import type { DocumentType } from "../domain/numbering.ts";
import type { DocumentRepository, SignedUnitOfWork, StoredDocument } from "./ports.ts";

/** Duración del arriendo de un intento: lo retoma una repetición o un reintento si el proceso cae. */
export const ATTEMPT_LEASE_SECONDS = 120;

/** Firma de un XML con la firma vigente de la empresa (`signingModule(...).documents`). */
export type DocumentSigner = {
  signDocument(
    companyId: string,
    xml: string,
    documentType: DocumentType,
  ): Promise<{ xml: string; certificateFingerprint: string; certificateId: string }>;
};

/** El snapshot no se puede escribir como XML; el código nunca lleva datos del comprobante. */
export class XmlBuildFailure extends Error {
  readonly code: "SCHEMA_UNAVAILABLE" | "INVALID_SNAPSHOT_AMOUNT" | "INVALID_SNAPSHOT_TEXT";
  constructor(code: XmlBuildFailure["code"]) {
    super(code);
    this.name = "XmlBuildFailure";
    this.code = code;
  }
}

/** XML de un tipo desde su snapshot. Lanza `XmlBuildFailure` si el snapshot no se puede escribir. */
export type SnapshotXmlBuilder = Readonly<{
  /** Versión del builder, que el artefacto registra. */
  version: string;
  build(snapshot: unknown): string;
}>;

/** Auditoría del paso a SIGNED de un tipo: su acción y sus cambios, sin XML ni bytes. */
export type SignedAudit = Readonly<{
  action: AuditAction;
  changes(document: StoredDocument, artifactSha256: string): AuditChanges;
}>;

/** Lo que difiere por tipo en la firma; el resto del procedimiento es el mismo. */
export type SigningProfile = Readonly<{
  documentType: DocumentType;
  xml: SnapshotXmlBuilder;
  signedAudit: SignedAudit;
}>;

/** El esquema que el snapshot de cada tipo fija al reservar. */
type PinnedSchema = Readonly<{
  schema: Readonly<{
    version: string;
    path: string;
    sha256: string;
    imports: readonly SchemaFile[];
  }>;
}>;

/** Etapa del benchmark y del histograma de la emisión para cada etapa del intento. */
const TIMING_STAGE: Record<SigningAttemptStage, string> = {
  BUILD_XML: "xml",
  VALIDATE_XSD: "xsd",
  SIGN: "sign",
  VALIDATE_SIGNED_XSD: "xsd",
  PERSIST: "persist",
};

/** Fallo tipado de una etapa del intento. */
class AttemptFailure extends Error {
  readonly code: SigningAttemptCode;
  readonly detail: AttemptDetail | null;
  constructor(code: SigningAttemptCode, detail: AttemptDetail | null = null) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

const SIGNING_CODES: ReadonlySet<string> = new Set([
  "SIGNING_CERTIFICATE_NOT_USABLE",
  "CUSTODY_UNAVAILABLE",
  "CERTIFICATE_MISMATCH",
  "SIGNER_FAILED",
  "CRYPTO_BUSY",
  "CRYPTO_TIMEOUT",
  "CRYPTO_UNAVAILABLE",
]);

/** Errores del validador: VALIDATOR_FAILED es un esquema que no compila o un motor caído. */
function validatorFailure(error: unknown): AttemptFailure {
  if (error instanceof XsdValidatorError) {
    switch (error.code) {
      case "VALIDATOR_BUSY":
      case "VALIDATOR_TIMEOUT":
      case "SCHEMA_HASH_MISMATCH":
      case "SCHEMA_UNAVAILABLE":
        return new AttemptFailure(error.code);
      default:
        return new AttemptFailure("SCHEMA_UNAVAILABLE");
    }
  }
  return new AttemptFailure("SCHEMA_UNAVAILABLE");
}

/** Solo la línea y el nombre del elemento: el mensaje de libxml2 puede citar datos del comprador. */
function xsdDetail(result: XsdValidation): AttemptDetail | null {
  if (result.valid) return null;
  const first = result.violations[0];
  if (!first) return null;
  const element = /^Element '([^']{1,200})'/.exec(first.message)?.[1] ?? null;
  return { line: first.line, element };
}

export type SigningPipelineDependencies = {
  documents: DocumentRepository;
  persist: SignedUnitOfWork;
  profile: SigningProfile;
  xsd: Pick<XsdValidator, "validate">;
  signer: DocumentSigner;
  /** Versiones del firmador que registra el artefacto. */
  signerVersion: string;
  now?: () => Date;
  logger?: { error(details: object, message: string): void };
};

/** Estado actual del comprobante y si se inició un intento (no, si ya estaba firmado o en curso). */
export type SigningAttempt = Readonly<{ document: StoredDocument; attempted: boolean }>;

export function createSigningPipeline(deps: SigningPipelineDependencies) {
  const now = deps.now ?? (() => new Date());
  const { profile } = deps;

  /** Pide un intento hacia SIGNED: solo empieza si el comprobante sigue RESERVED y toma el arriendo. */
  async function attempt(
    ctx: RequestContext,
    document: StoredDocument,
    timings: StageTimings = NO_TIMINGS,
  ): Promise<SigningAttempt> {
    if (document.documentType !== profile.documentType) {
      throw new Error("El comprobante no es del tipo de este procedimiento de firma.");
    }
    if (document.state !== "RESERVED") return { document, attempted: false };
    const started = now();
    const leased = await deps.documents.acquireAttemptLease(
      ctx.companyId,
      document.id,
      started,
      new Date(started.getTime() + ATTEMPT_LEASE_SECONDS * 1000),
    );
    // Otro intento está en curso: se devuelve el estado actual sin intentar.
    if (!leased) {
      const current = (await deps.documents.find(ctx.companyId, document.id)) ?? document;
      return { document: current, attempted: false };
    }
    return { document: await run(ctx, document, timings), attempted: true };
  }

  /** Lleva un comprobante RESERVED a SIGNED, o deja su diagnóstico. Devuelve su estado actual. */
  async function continueToSigned(
    ctx: RequestContext,
    document: StoredDocument,
    timings: StageTimings = NO_TIMINGS,
  ): Promise<StoredDocument> {
    return (await attempt(ctx, document, timings)).document;
  }

  /** Las etapas del intento, con el arriendo ya tomado. */
  async function run(
    ctx: RequestContext,
    document: StoredDocument,
    timings: StageTimings,
  ): Promise<StoredDocument> {
    const stage = <T>(
      name: SigningAttemptStage,
      current: { stage: SigningAttemptStage },
      work: () => Promise<T>,
    ): Promise<T> => {
      current.stage = name;
      return timings.measure(TIMING_STAGE[name], work);
    };
    const { companyId } = ctx;
    const pinned = (document.snapshot as PinnedSchema).schema;
    const schema: RegisteredSchema = {
      documentType: document.documentType,
      version: pinned.version,
      path: pinned.path,
      sha256: pinned.sha256,
      imports: pinned.imports,
    };
    const current: { stage: SigningAttemptStage } = { stage: "BUILD_XML" };
    try {
      const xml = await stage("BUILD_XML", current, () => {
        try {
          return Promise.resolve(profile.xml.build(document.snapshot));
        } catch (error) {
          if (error instanceof XmlBuildFailure) throw new AttemptFailure(error.code);
          throw new AttemptFailure("INVALID_SNAPSHOT_TEXT");
        }
      });
      await stage("VALIDATE_XSD", current, async () => {
        const result = await deps.xsd.validate(xml, schema).catch((error: unknown) => {
          throw validatorFailure(error);
        });
        if (!result.valid) throw new AttemptFailure("XSD_INVALID", xsdDetail(result));
      });
      const signed = await stage("SIGN", current, () =>
        deps.signer.signDocument(companyId, xml, document.documentType).catch((error: unknown) => {
          const code = (error as { code?: unknown } | null)?.code;
          throw new AttemptFailure(
            typeof code === "string" && SIGNING_CODES.has(code)
              ? (code as SigningAttemptCode)
              : "CRYPTO_UNAVAILABLE",
          );
        }),
      );
      await stage("VALIDATE_SIGNED_XSD", current, async () => {
        const result = await deps.xsd.validate(signed.xml, schema).catch((error: unknown) => {
          throw validatorFailure(error);
        });
        if (!result.valid) throw new AttemptFailure("SIGNED_XML_INVALID", xsdDetail(result));
      });
      return await stage("PERSIST", current, async () => {
        try {
          return await deps.persist.run(async (scope) => {
            const artifact = await scope.artifacts.save({
              companyId,
              documentId: document.id,
              kind: "SIGNED_XML",
              mediaType: "application/xml",
              content: Buffer.from(signed.xml, "utf8"),
              metadata: {
                documentType: document.documentType,
                schemaVersion: schema.version,
                schemaPath: schema.path,
                schemaSha256: schema.sha256,
                imports: schema.imports.map(({ path, sha256 }) => ({ path, sha256 })),
                builderVersion: profile.xml.version,
                signerVersion: deps.signerVersion,
                certificateFingerprint: signed.certificateFingerprint,
              },
            });
            const signedAt = now();
            if (!(await scope.documents.markSigned(companyId, document.id, signedAt))) {
              throw new Error("El comprobante dejó de estar RESERVED durante el intento.");
            }
            await scope.documents.recordTransition({
              companyId,
              documentId: document.id,
              from: "RESERVED",
              to: "SIGNED",
              cause: "SIGNING",
              actor: { type: "USER", userId: ctx.userId },
              metadata: { artifactSha256: artifact.sha256, correlationId: ctx.requestId },
            });
            await scope.enqueueTransmission(document);
            await scope.audit.append({
              companyId,
              actor: { type: "USER", userId: ctx.userId },
              action: profile.signedAudit.action,
              changes: profile.signedAudit.changes(document, artifact.sha256),
              correlationId: ctx.requestId,
            });
            return (await scope.documents.find(companyId, document.id))!;
          });
        } catch (error) {
          deps.logger?.error(
            { err: error, documentId: document.id, documentType: document.documentType },
            "no se pudo guardar el comprobante firmado",
          );
          throw new AttemptFailure("PERSIST_FAILED");
        }
      });
    } catch (error) {
      const failure =
        error instanceof AttemptFailure
          ? error
          : new AttemptFailure(current.stage === "SIGN" ? "CRYPTO_UNAVAILABLE" : "PERSIST_FAILED");
      if (!(error instanceof AttemptFailure)) {
        deps.logger?.error(
          { err: error, documentId: document.id, stage: current.stage },
          "fallo inesperado en el intento de firma",
        );
      }
      await deps.documents.recordAttemptFailure(companyId, document.id, {
        stage: current.stage,
        code: failure.code,
        class: SIGNING_ATTEMPT_CODES[failure.code],
        at: now(),
        detail: failure.detail,
      });
      return (await deps.documents.find(companyId, document.id)) ?? document;
    }
  }

  return { attempt, continueToSigned };
}

export type SigningPipeline = ReturnType<typeof createSigningPipeline>;

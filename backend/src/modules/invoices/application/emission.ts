// Emisión de una factura desde un borrador (add-invoice-emission, design D6 a D9). Fuera de la
// transacción: permiso, cabecera Idempotency-Key, repetición en el registro y archivos del esquema.
// Dentro, en el orden de D7: borrador bloqueado, configuración bloqueada, evaluación, snapshot,
// la reserva compartida de `fiscal` (secuencial, identidad bloqueada, código numérico y clave,
// comprobante RESERVED con su transición; add-credit-notes D2), borrador EMITTED, registro de
// idempotencia y auditoría. Después del commit, la firma (D9). Las
// etapas `reservation_tx`, `validation_snapshot` y `arithmetic` se miden para el benchmark y el
// histograma de la emisión (D16).
import { emitInvoiceSchema } from "@facturador/contracts";
import {
  idempotencyKeyReused,
  readIdempotencyKey,
  requestFingerprint,
  IdempotencyCollisionError,
  type IdempotencyStore,
} from "../../../platform/idempotency/idempotency.ts";
import { NO_TIMINGS, type StageTimings } from "../../../platform/metrics/stage-timings.ts";
import { reserveDocumentIn } from "../../fiscal/application/document-reservation.ts";
import type { DocumentRepository, StoredDocument } from "../../fiscal/application/ports.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { AccessKeys, XsdValidator } from "../../sri-engine/application/ports.ts";
import { registeredSchema } from "../../sri-engine/application/schemas.ts";
import { evaluateInvoice } from "../domain/evaluation.ts";
import { buildSnapshot, withKey, type InvoiceSnapshot } from "../domain/snapshot.ts";
import {
  DraftAlreadyEmittedError,
  EmissionRejectedError,
  draftChanged,
  draftNotFound,
} from "./errors.ts";
import { INVOICE_SCHEMA, readEvaluation } from "./evaluation.ts";
import type { EmissionUnitOfWork, EvaluationReads } from "./ports.ts";

export const EMIT_OPERATION = "invoice.emit" as const;

/** El borrador ya estaba emitido al bloquearlo: se resuelve fuera de la transacción revertida. */
class DraftEmittedSignal extends Error {
  readonly documentId: string | null;
  constructor(documentId: string | null) {
    super("El borrador ya está emitido.");
    this.documentId = documentId;
  }
}

export type EmissionResult = Readonly<{ document: StoredDocument; replayed: boolean }>;

/** Continúa un comprobante reservado hacia `SIGNED` (design D9); sin firma configurada, lo deja. */
export type ContinueToSigned = (
  ctx: RequestContext,
  document: StoredDocument,
  timings?: StageTimings,
) => Promise<StoredDocument>;

export type EmissionDependencies = {
  uow: EmissionUnitOfWork;
  /** Lecturas fuera de la transacción: el registro de esquemas antes de reservar. */
  reads: EvaluationReads;
  idempotency: IdempotencyStore;
  documents: DocumentRepository;
  accessKeys: AccessKeys;
  xsd: Pick<XsdValidator, "ensureAvailable">;
  builderVersion: string;
  authorizer: Authorizer;
  /** Reloj de la fecha de emisión, capturada una vez en America/Guayaquil. */
  today: () => string;
  maxLines: number;
  continueToSigned?: ContinueToSigned;
  logger?: { warn(details: object, message: string): void };
};

const schemaUnavailable = () =>
  new EmissionRejectedError({
    code: "SCHEMA_NOT_AVAILABLE",
    message:
      "El esquema XSD de la factura 1.1.0 o uno de sus imports falta o no coincide con su hash.",
    line: null,
    payment: null,
  });

export function createEmission(deps: EmissionDependencies) {
  const continueToSigned: ContinueToSigned =
    deps.continueToSigned ?? ((_ctx, document) => Promise.resolve(document));

  async function replay(
    ctx: RequestContext,
    documentId: string,
    timings: StageTimings,
  ): Promise<EmissionResult> {
    const document = await deps.documents.find(ctx.companyId, documentId);
    if (!document)
      throw new Error("El registro de idempotencia apunta a un comprobante inexistente.");
    const current =
      document.state === "RESERVED" ? await continueToSigned(ctx, document, timings) : document;
    return { document: current, replayed: true };
  }

  /** Misma clave: la misma solicitud repite; otra solicitud es un conflicto. */
  async function resolveExisting(
    ctx: RequestContext,
    key: string,
    fingerprint: string,
    timings: StageTimings,
  ): Promise<EmissionResult | null> {
    const record = await deps.idempotency.find(ctx.companyId, EMIT_OPERATION, key);
    if (!record) return null;
    if (record.fingerprint !== fingerprint) throw idempotencyKeyReused();
    return replay(ctx, record.documentId, timings);
  }

  /** Archivos del esquema disponibles con su hash, antes de abrir la transacción (design D6). */
  async function ensureSchema(): Promise<void> {
    const schema = registeredSchema(
      await deps.reads.catalogs.schemaRegistry(),
      INVOICE_SCHEMA.documentType,
      INVOICE_SCHEMA.version,
    );
    // Sin esquema registrado, la evaluación lo rechaza con el mismo código.
    if (!schema) return;
    try {
      await deps.xsd.ensureAvailable(schema);
    } catch {
      throw schemaUnavailable();
    }
  }

  async function reserve(
    ctx: RequestContext,
    input: { draftId: string; expectedVersion: number },
    key: string,
    fingerprint: string,
    issueDate: string,
    timings: StageTimings,
  ): Promise<StoredDocument> {
    return deps.uow.run(async (scope) => {
      // 1. Borrador bloqueado.
      const draft = await scope.lockDraft(ctx.companyId, input.draftId);
      if (!draft) throw draftNotFound();
      if (draft.status === "EMITTED") throw new DraftEmittedSignal(draft.documentId);
      if (draft.version !== input.expectedVersion) throw draftChanged();
      // 2. Configuración bloqueada; 3. evaluación con lecturas coherentes.
      await scope.lockConfiguration(ctx.companyId);
      const context = await timings.measure("validation_snapshot", () =>
        readEvaluation(scope.reads, ctx.companyId, draft, issueDate, deps.maxLines),
      );
      const evaluation = timings.measureSync("validation_snapshot", () =>
        evaluateInvoice(context.input, (work) => timings.measureSync("arithmetic", work)),
      );
      const first = evaluation.issues[0];
      if (first) throw new EmissionRejectedError(first);
      const { config, schema, input: evaluated } = context;
      if (!config || !schema || !evaluated.point) throw new Error("Evaluación incompleta.");
      // 4. Snapshot sin el secuencial.
      const draftSnapshot = await timings.measure("validation_snapshot", async () =>
        buildSnapshot({
          input: evaluated,
          evaluation,
          schema: {
            documentType: "01",
            version: schema.version,
            path: schema.path,
            sha256: schema.sha256,
            imports: schema.imports.map(({ path, sha256 }) => ({ path, sha256 })),
          },
          builderVersion: deps.builderVersion,
          datasetVersions: await scope.reads.catalogs.datasetVersions(),
        }),
      );
      // 5 a 8. Secuencial, identidad bloqueada, clave y comprobante RESERVED con su transición.
      const { document, snapshot } = await reserveDocumentIn(scope, deps.accessKeys, {
        companyId: ctx.companyId,
        documentType: "01",
        issueDate,
        environment: draftSnapshot.environment,
        environmentCode: draftSnapshot.environmentCode,
        ruc: draftSnapshot.issuer.ruc,
        establishment: draftSnapshot.issuer.establishment,
        emissionPoint: draftSnapshot.issuer.emissionPoint,
        reservedBy: ctx.userId,
        correlationId: ctx.requestId,
        withKey: (key): InvoiceSnapshot => withKey(draftSnapshot, key),
        columns: (snapshot) => ({
          receiver: "BUYER",
          schemaVersion: snapshot.schema.version,
          buyerIdentification: snapshot.buyer.identification,
          buyerName: snapshot.buyer.legalName,
          total: snapshot.totals.total,
        }),
      });
      // El borrador EMITTED.
      await scope.markDraftEmitted(ctx.companyId, draft.id, document.id, ctx.userId);
      // 9. Registro de idempotencia: su clave única es la última defensa.
      await scope.idempotency.insert({
        companyId: ctx.companyId,
        operation: EMIT_OPERATION,
        key,
        fingerprint,
        documentId: document.id,
        createdBy: ctx.userId,
      });
      // 10. Auditoría, sin XML ni bytes.
      await scope.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "invoice.reserved",
        changes: {
          invoiceId: document.id,
          documentNumber: document.documentNumber,
          accessKey: snapshot.key.accessKey,
          environment: document.environment,
          total: document.total,
        },
        correlationId: ctx.requestId,
      });
      return document;
    });
  }

  return {
    async emit(
      ctx: RequestContext,
      idempotencyKey: string | readonly string[] | undefined,
      body: unknown,
      timings: StageTimings = NO_TIMINGS,
    ): Promise<EmissionResult> {
      deps.authorizer.requirePermission(ctx, "invoices.emit");
      const key = readIdempotencyKey(idempotencyKey);
      const input = parseInput(emitInvoiceSchema, body);
      const fingerprint = requestFingerprint(EMIT_OPERATION, input);
      const existing = await resolveExisting(ctx, key, fingerprint, timings);
      if (existing) return existing;
      // La fecha de emisión se captura una sola vez y viaja como argumento (design D6).
      const issueDate = deps.today();
      await ensureSchema();
      let document: StoredDocument;
      try {
        document = await timings.envelope("reservation_tx", () =>
          reserve(ctx, input, key, fingerprint, issueDate, timings),
        );
      } catch (error) {
        if (error instanceof IdempotencyCollisionError) {
          const resolved = await resolveExisting(ctx, key, fingerprint, timings);
          if (resolved) return resolved;
        }
        if (error instanceof DraftEmittedSignal) {
          const resolved = await resolveExisting(ctx, key, fingerprint, timings);
          if (resolved) return resolved;
          throw new DraftAlreadyEmittedError(error.documentId);
        }
        if ((error as { code?: unknown }).code === "SEQUENCE_EXHAUSTED") {
          deps.logger?.warn(
            { companyId: ctx.companyId, draftId: input.draftId },
            "numeración agotada al emitir una factura",
          );
        }
        throw error;
      }
      return { document: await continueToSigned(ctx, document, timings), replayed: false };
    },
  };
}

export type Emission = ReturnType<typeof createEmission>;

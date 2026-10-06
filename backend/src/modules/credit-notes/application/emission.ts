// Emisión de una nota de crédito desde su borrador (add-credit-notes, design D4, D7, D10, D11 y
// D24). Fuera de la transacción: permiso, cabecera Idempotency-Key, repetición en el registro,
// archivos del esquema y la comprobación previa completa con la capacidad vigente, sin consumir
// secuencial, clave, firma ni llamada al SRI. Dentro, sin I/O externo mientras la factura está
// bloqueada: borrador bloqueado, configuración bloqueada, capacidad de la factura bloqueada,
// evaluación otra vez con lo reservado y aplicado vigente, capacidad acreditable y devolvible
// reservadas, la reserva compartida de `fiscal` (secuencial, identidad, clave, comprobante RESERVED
// y su transición), el snapshot autosuficiente, las filas de las reservas de la nota, el borrador
// EMITTED, el registro de idempotencia y la auditoría. Todo o nada. Después del commit, la firma
// con el perfil de la nota.
import { emitCreditNoteSchema, type CreditNoteIssue } from "@facturador/contracts";
import {
  IdempotencyCollisionError,
  idempotencyKeyReused,
  readIdempotencyKey,
  requestFingerprint,
  type IdempotencyStore,
} from "../../../platform/idempotency/idempotency.ts";
import { NO_TIMINGS, type StageTimings } from "../../../platform/metrics/stage-timings.ts";
import { reserveDocumentIn } from "../../fiscal/application/document-reservation.ts";
import type { DocumentRepository, StoredDocument } from "../../fiscal/application/ports.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { AccessKeys, XsdValidator } from "../../sri-engine/application/ports.ts";
import { registeredSchema } from "../../sri-engine/application/schemas.ts";
import { buildCreditNoteSnapshot } from "../domain/build-snapshot.ts";
import type { CreditNoteDraftRecord } from "../domain/draft.ts";
import { withCreditNoteKey, type CreditNoteSnapshot } from "../domain/snapshot.ts";
import {
  CREDIT_NOTE_SCHEMA,
  loadCreditContext,
  returnsOf,
  type ContextReads,
  type CreditContext,
} from "./context.ts";
import {
  CreditNoteRejectedError,
  DraftAlreadyEmittedError,
  draftChanged,
  draftNotFound,
  invoiceNotFound,
} from "./errors.ts";
import {
  CreditCapacityExceededError,
  STOCK_RETURN_EXCEEDED,
  type CreditNoteEmissionUnitOfWork,
} from "./ports.ts";

export const CREDIT_NOTE_EMIT_OPERATION = "credit_note.emit" as const;

/** Motivo de un rechazo por capacidad (métrica `credit_note_reservation_conflicts_total`). */
export type CapacityConflictReason = "QUANTITY" | "AMOUNT" | "TOTAL_ANNULMENT" | "PHYSICAL_RETURN";

const CONFLICT_REASONS: Partial<Record<CreditNoteIssue["code"], CapacityConflictReason>> = {
  CREDIT_NOTE_QUANTITY_EXCEEDED: "QUANTITY",
  CREDIT_NOTE_AMOUNT_EXCEEDED: "AMOUNT",
  CREDIT_NOTE_TOTAL_ANNULMENT_NOT_AVAILABLE: "TOTAL_ANNULMENT",
  CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED: "PHYSICAL_RETURN",
};

export type CreditNoteEmissionObserver = Readonly<{
  reserved(cause: string): void;
  conflict(reason: CapacityConflictReason): void;
}>;

/** El borrador ya estaba emitido al bloquearlo: se resuelve fuera de la transacción revertida. */
class DraftEmittedSignal extends Error {
  readonly documentId: string | null;
  constructor(documentId: string | null) {
    super("El borrador ya está emitido.");
    this.documentId = documentId;
  }
}

export type CreditNoteEmissionResult = Readonly<{ document: StoredDocument; replayed: boolean }>;

export type ContinueToSigned = (
  ctx: RequestContext,
  document: StoredDocument,
  timings?: StageTimings,
) => Promise<StoredDocument>;

export type CreditNoteEmissionDependencies = {
  uow: CreditNoteEmissionUnitOfWork;
  /** Lecturas sobre la conexión para la comprobación previa. */
  context: ContextReads;
  drafts: Readonly<{
    find(companyId: string, draftId: string): Promise<CreditNoteDraftRecord | null>;
  }>;
  idempotency: IdempotencyStore;
  documents: DocumentRepository;
  accessKeys: AccessKeys;
  xsd: Pick<XsdValidator, "ensureAvailable">;
  builderVersion: string;
  authorizer: Authorizer;
  /** Reloj de la fecha de emisión, capturada una vez en America/Guayaquil. */
  today: () => string;
  now?: () => Date;
  continueToSigned?: ContinueToSigned;
  observer?: CreditNoteEmissionObserver;
};

const first = (context: CreditContext): CreditNoteIssue | undefined => context.evaluation.issues[0];

/** Huella de la emisión (design D11): el borrador, su versión y las declaraciones como conjunto. */
const fingerprintOf = (input: {
  draftId: string;
  expectedVersion: number;
  declarations: { version: number; statements: readonly string[] };
}) =>
  requestFingerprint(CREDIT_NOTE_EMIT_OPERATION, {
    draftId: input.draftId,
    expectedVersion: input.expectedVersion,
    declarations: {
      version: input.declarations.version,
      statements: [...input.declarations.statements].sort(),
    },
  });

export function createCreditNoteEmission(deps: CreditNoteEmissionDependencies) {
  const now = deps.now ?? (() => new Date());
  const continueToSigned: ContinueToSigned =
    deps.continueToSigned ?? ((_ctx, document) => Promise.resolve(document));

  /** Rechazo antes de reservar: la métrica de capacidad si corresponde y el primer problema. */
  function reject(found: CreditNoteIssue): never {
    const reason = CONFLICT_REASONS[found.code];
    if (reason) deps.observer?.conflict(reason);
    throw new CreditNoteRejectedError(found);
  }

  async function replay(ctx: RequestContext, documentId: string, timings: StageTimings) {
    const document = await deps.documents.find(ctx.companyId, documentId);
    if (!document)
      throw new Error("El registro de idempotencia apunta a un comprobante inexistente.");
    const current =
      document.state === "RESERVED" ? await continueToSigned(ctx, document, timings) : document;
    return { document: current, replayed: true };
  }

  /** Misma clave: la misma solicitud repite (y reanuda la firma); otra es un conflicto. */
  async function resolveExisting(
    ctx: RequestContext,
    key: string,
    fingerprint: string,
    timings: StageTimings,
  ): Promise<CreditNoteEmissionResult | null> {
    const record = await deps.idempotency.find(ctx.companyId, CREDIT_NOTE_EMIT_OPERATION, key);
    if (!record) return null;
    if (record.fingerprint !== fingerprint) throw idempotencyKeyReused();
    return replay(ctx, record.documentId, timings);
  }

  /** Archivos del esquema disponibles con su hash, antes de abrir la transacción. */
  async function ensureSchema(): Promise<void> {
    const schema = registeredSchema(
      await deps.context.reads.schemaRegistry(),
      CREDIT_NOTE_SCHEMA.documentType,
      CREDIT_NOTE_SCHEMA.version,
    );
    if (!schema) return;
    try {
      await deps.xsd.ensureAvailable(schema);
    } catch {
      throw new CreditNoteRejectedError({
        code: "SCHEMA_NOT_AVAILABLE",
        message:
          "El esquema XSD de la nota de crédito 1.1.0 o uno de sus imports falta o no coincide con su hash.",
        line: null,
      });
    }
  }

  async function reserve(
    ctx: RequestContext,
    input: {
      draftId: string;
      expectedVersion: number;
      declarations: { version: number; statements: readonly string[] };
    },
    key: string,
    fingerprint: string,
    issueDate: string,
  ): Promise<StoredDocument> {
    return deps.uow.run(async (scope) => {
      // 1. Borrador bloqueado y su versión.
      const draft = await scope.lockDraft(ctx.companyId, input.draftId);
      if (!draft) throw draftNotFound();
      if (draft.status === "EMITTED") throw new DraftEmittedSignal(draft.documentId);
      if (draft.version !== input.expectedVersion) throw draftChanged();
      // 2. Configuración bloqueada y capacidad de la factura bloqueada, antes de leer lo vigente.
      await scope.lockConfiguration(ctx.companyId);
      await scope.capacity.lock(ctx.companyId, draft.invoiceId);
      // 3. Evaluación otra vez con lo reservado y aplicado vigente (design D6).
      const invoice = await scope.invoices.find(ctx.companyId, draft.invoiceId);
      if (!invoice) throw invoiceNotFound();
      const context = await loadCreditContext(
        scope,
        ctx.companyId,
        invoice,
        draft,
        input.declarations,
      );
      const issue = first(context);
      if (issue) reject(issue);
      const { config, point, schema, evaluation } = context;
      const amounts = evaluation.amounts;
      if (
        !config ||
        !point ||
        !schema ||
        !amounts?.totals ||
        !draft.reason ||
        !invoice.authorization
      ) {
        throw new Error("Evaluación incompleta.");
      }
      // 4. Capacidad acreditable reservada; el CHECK de la base es la última defensa.
      try {
        await scope.capacity.initialize({
          companyId: ctx.companyId,
          invoiceId: invoice.id,
          total: invoice.totals.total,
          lines: invoice.lines.map(({ position, productId, quantity }) => ({
            position,
            productId,
            quantity,
          })),
        });
        await scope.capacity.reserve({
          companyId: ctx.companyId,
          invoiceId: invoice.id,
          amount: amounts.totals.total,
          lines: amounts.lines.map(({ position, quantity }) => ({ position, quantity })),
        });
      } catch (error) {
        if (error instanceof CreditCapacityExceededError) {
          reject({
            code:
              error.kind === "AMOUNT"
                ? "CREDIT_NOTE_AMOUNT_EXCEEDED"
                : "CREDIT_NOTE_QUANTITY_EXCEEDED",
            message: "La nota excede la capacidad acreditable de la factura.",
            line: null,
          });
        }
        throw error;
      }
      // 5. Capacidad devolvible reservada por producto.
      const returns = returnsOf(context);
      try {
        await scope.returns.reserve({ companyId: ctx.companyId, invoiceId: invoice.id, returns });
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === STOCK_RETURN_EXCEEDED) {
          reject({
            code: "CREDIT_NOTE_PHYSICAL_RETURN_EXCEEDED",
            message: "El retorno físico supera lo que la factura sacó del inventario.",
            line: null,
          });
        }
        throw error;
      }
      // 6. Snapshot sin la reserva; 7. secuencial, identidad, clave y comprobante RESERVED.
      const draftSnapshot = buildCreditNoteSnapshot({
        invoice: { ...invoice, authorization: invoice.authorization },
        config,
        point,
        schema: {
          documentType: "04",
          version: schema.version,
          path: schema.path,
          sha256: schema.sha256,
          imports: schema.imports.map(({ path, sha256 }) => ({ path, sha256 })),
        },
        builderVersion: deps.builderVersion,
        datasetVersions: await scope.reads.datasetVersions(),
        issueDate,
        cause: draft.cause,
        reason: draft.reason,
        lines: evaluation.lines,
        amounts,
        declarations: {
          version: input.declarations.version,
          statements: [
            ...input.declarations.statements,
          ].sort() as CreditNoteSnapshot["declarations"]["statements"],
          declaredBy: ctx.userId,
          declaredAt: now().toISOString(),
          basis: "USER_DECLARED",
        },
      });
      const { document, snapshot } = await reserveDocumentIn(scope, deps.accessKeys, {
        companyId: ctx.companyId,
        documentType: "04",
        issueDate,
        environment: draftSnapshot.environment,
        environmentCode: draftSnapshot.environmentCode,
        ruc: draftSnapshot.issuer.ruc,
        establishment: draftSnapshot.issuer.establishment,
        emissionPoint: draftSnapshot.issuer.emissionPoint,
        reservedBy: ctx.userId,
        correlationId: ctx.requestId,
        withKey: (key): CreditNoteSnapshot => withCreditNoteKey(draftSnapshot, key),
        columns: (built) => ({
          receiver: "BUYER",
          schemaVersion: built.schema.version,
          buyerIdentification: built.buyer.identification,
          buyerName: built.buyer.legalName,
          total: built.totals.total,
        }),
      });
      // 8. Filas de las reservas de la nota, ya creada.
      await scope.capacity.record({
        companyId: ctx.companyId,
        invoiceId: invoice.id,
        creditNoteId: document.id,
        cause: draft.cause,
        amount: amounts.totals.total,
        lines: snapshot.lines.map((line) => ({
          position: line.invoicePosition,
          quantity: line.quantity,
          subtotal: line.subtotal,
          discount: line.discount,
          taxableBase: line.taxableBase,
          taxes: line.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
            taxCode,
            rateCode,
            percentage,
            base,
            amount,
          })),
          physicalReturn: line.physicalReturn,
        })),
      });
      await scope.returns.record({
        companyId: ctx.companyId,
        invoiceId: invoice.id,
        creditNoteId: document.id,
        returns,
      });
      // 9. Borrador EMITTED, registro de idempotencia y auditoría, sin XML ni bytes.
      await scope.markDraftEmitted(ctx.companyId, draft.id, document.id, ctx.userId);
      await scope.idempotency.insert({
        companyId: ctx.companyId,
        operation: CREDIT_NOTE_EMIT_OPERATION,
        key,
        fingerprint,
        documentId: document.id,
        createdBy: ctx.userId,
      });
      await scope.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "credit_note.reserved",
        changes: {
          creditNoteId: document.id,
          documentNumber: document.documentNumber,
          accessKey: snapshot.key.accessKey,
          environment: document.environment,
          total: document.total,
          invoiceId: invoice.id,
          invoiceNumber: invoice.documentNumber,
          cause: draft.cause,
          declarationVersion: snapshot.declarations.version,
          declarations: [...snapshot.declarations.statements],
          lineCount: snapshot.lines.length,
          physicalReturn: returns.length > 0,
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
    ): Promise<CreditNoteEmissionResult> {
      deps.authorizer.requirePermission(ctx, "creditNotes.emit");
      const key = readIdempotencyKey(idempotencyKey);
      const input = parseInput(emitCreditNoteSchema, body);
      const fingerprint = fingerprintOf(input);
      const existing = await resolveExisting(ctx, key, fingerprint, timings);
      if (existing) return existing;
      // La fecha de emisión se captura una sola vez y viaja como argumento.
      const issueDate = deps.today();
      await ensureSchema();
      // Comprobación previa fuera de la transacción: un rechazo no consume nada (design D4).
      const draft = await deps.drafts.find(ctx.companyId, input.draftId);
      if (!draft) throw draftNotFound();
      if (draft.status === "EMITTED") {
        const resolved = await resolveExisting(ctx, key, fingerprint, timings);
        if (resolved) return resolved;
        throw new DraftAlreadyEmittedError(draft.documentId);
      }
      if (draft.version !== input.expectedVersion) throw draftChanged();
      const invoice = await deps.context.invoices.find(ctx.companyId, draft.invoiceId);
      if (!invoice) throw invoiceNotFound();
      const preliminary = await loadCreditContext(
        deps.context,
        ctx.companyId,
        invoice,
        draft,
        input.declarations,
      );
      const issue = first(preliminary);
      if (issue) reject(issue);

      let document: StoredDocument;
      try {
        document = await timings.envelope("reservation_tx", () =>
          reserve(ctx, input, key, fingerprint, issueDate),
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
        throw error;
      }
      deps.observer?.reserved(draft.cause);
      return { document: await continueToSigned(ctx, document, timings), replayed: false };
    },
  };
}

export type CreditNoteEmission = ReturnType<typeof createCreditNoteEmission>;

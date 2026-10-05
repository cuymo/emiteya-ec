// Emisión de una nota de débito desde su borrador (add-debit-notes, design D4, D8, D13, D14 y D15).
// Fuera de la transacción: permiso, cabecera Idempotency-Key, el borrador de la empresa, la huella
// canónica y la repetición en el registro, los archivos del esquema y la comprobación previa
// completa, sin consumir secuencial, clave, firma ni llamada al SRI. Dentro, sin I/O externo:
// borrador bloqueado, configuración bloqueada, la factura y la forma de pago evaluadas otra vez con
// lecturas de la base, el snapshot autosuficiente, la reserva compartida de `fiscal` (secuencial,
// identidad, clave, comprobante RESERVED y su transición), la factura de la nota, el borrador
// EMITTED, el registro de idempotencia y la auditoría. Todo o nada. La factura no se bloquea: está
// en un estado terminal y la nota no consume ninguna capacidad suya. Después del commit, la firma
// con el perfil de la nota.
import { DEBIT_NOTE_CAUSES, emitDebitNoteSchema, type DebitNoteIssue } from "@facturador/contracts";
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
import { buildDebitNoteSnapshot } from "../domain/build-snapshot.ts";
import type { DebitNoteDraftRecord } from "../domain/draft.ts";
import { withDebitNoteKey, type DebitNoteSnapshot } from "../domain/snapshot.ts";
import {
  DEBIT_NOTE_SCHEMA,
  loadDebitContext,
  type ContextReads,
  type DebitContext,
} from "./context.ts";
import {
  DebitNoteRejectedError,
  DraftAlreadyEmittedError,
  draftChanged,
  draftNotFound,
  invoiceNotFound,
} from "./errors.ts";
import type { DebitNoteEmissionUnitOfWork } from "./ports.ts";

export const DEBIT_NOTE_EMIT_OPERATION = "debit_note.emit" as const;

export type DebitNoteEmissionObserver = Readonly<{
  /** Una reserva confirmada, con la causa de cada concepto. */
  reserved(causes: readonly string[]): void;
}>;

/** El borrador ya estaba emitido al bloquearlo: se resuelve fuera de la transacción revertida. */
class DraftEmittedSignal extends Error {
  readonly documentId: string | null;
  constructor(documentId: string | null) {
    super("El borrador ya está emitido.");
    this.documentId = documentId;
  }
}

export type DebitNoteEmissionResult = Readonly<{ document: StoredDocument; replayed: boolean }>;

export type ContinueToSigned = (
  ctx: RequestContext,
  document: StoredDocument,
  timings?: StageTimings,
) => Promise<StoredDocument>;

export type DebitNoteEmissionDependencies = {
  uow: DebitNoteEmissionUnitOfWork;
  /** Lecturas sobre la conexión para la comprobación previa. */
  context: ContextReads;
  drafts: Readonly<{
    find(companyId: string, draftId: string): Promise<DebitNoteDraftRecord | null>;
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
  observer?: DebitNoteEmissionObserver;
};

type EmitInput = Readonly<{
  draftId: string;
  expectedVersion: number;
  declarations: Readonly<{ version: number; statements: readonly string[] }>;
}>;

const first = (context: DebitContext): DebitNoteIssue | undefined => context.evaluation.issues[0];

/**
 * Huella canónica de la emisión (design D15): el borrador, su versión, la declaración como conjunto
 * y los datos funcionales de esa versión (factura, punto, forma de pago y conceptos en orden). Una
 * versión del borrador es inmutable, así que la huella de una repetición coincide; otros datos
 * nunca repiten una nota.
 */
export const debitNoteFingerprint = (input: EmitInput, draft: DebitNoteDraftRecord) =>
  requestFingerprint(DEBIT_NOTE_EMIT_OPERATION, {
    draftId: input.draftId,
    expectedVersion: input.expectedVersion,
    declarations: {
      version: input.declarations.version,
      statements: [...input.declarations.statements].sort(),
    },
    functional: {
      invoiceId: draft.invoiceId,
      emissionPointId: draft.emissionPointId,
      paymentMethod: draft.paymentMethod,
      concepts: draft.concepts.map(({ cause, description, amount, taxTreatment }) => ({
        cause,
        description,
        amount,
        taxTreatment,
      })),
    },
  });

/** Las causas distintas de los conceptos, en el orden del enum: sin descripciones ni importes. */
const causesOf = (snapshot: DebitNoteSnapshot) =>
  DEBIT_NOTE_CAUSES.filter((cause) => snapshot.concepts.some((c) => c.cause === cause));

export function createDebitNoteEmission(deps: DebitNoteEmissionDependencies) {
  const now = deps.now ?? (() => new Date());
  const continueToSigned: ContinueToSigned =
    deps.continueToSigned ?? ((_ctx, document) => Promise.resolve(document));

  /** Rechazo antes de reservar: el primer problema de la evaluación. */
  function reject(found: DebitNoteIssue): never {
    throw new DebitNoteRejectedError(found);
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
  ): Promise<DebitNoteEmissionResult | null> {
    const record = await deps.idempotency.find(ctx.companyId, DEBIT_NOTE_EMIT_OPERATION, key);
    if (!record) return null;
    if (record.fingerprint !== fingerprint) throw idempotencyKeyReused();
    return replay(ctx, record.documentId, timings);
  }

  /** Archivos del esquema disponibles con su hash, antes de abrir la transacción. */
  async function ensureSchema(): Promise<void> {
    const schema = registeredSchema(
      await deps.context.reads.schemaRegistry(),
      DEBIT_NOTE_SCHEMA.documentType,
      DEBIT_NOTE_SCHEMA.version,
    );
    if (!schema) return;
    try {
      await deps.xsd.ensureAvailable(schema);
    } catch {
      throw new DebitNoteRejectedError({
        code: "SCHEMA_NOT_AVAILABLE",
        message:
          "El esquema XSD de la nota de débito 1.0.0 o uno de sus imports falta o no coincide con su hash.",
        concept: null,
      });
    }
  }

  async function reserve(
    ctx: RequestContext,
    input: EmitInput,
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
      // 2. Configuración bloqueada: el emisor y su ambiente no cambian durante la reserva.
      await scope.lockConfiguration(ctx.companyId);
      // 3. Factura, forma de pago y evaluación otra vez, con lecturas de la base.
      const invoice = await scope.invoices.find(ctx.companyId, draft.invoiceId);
      if (!invoice) throw invoiceNotFound();
      const context = await loadDebitContext(
        scope,
        ctx.companyId,
        invoice,
        draft,
        issueDate,
        input.declarations,
      );
      const issue = first(context);
      if (issue) reject(issue);
      const { config, point, schema, evaluation } = context;
      if (
        !config ||
        !point ||
        !schema ||
        !evaluation.amounts ||
        !evaluation.payment ||
        !invoice.authorization
      ) {
        throw new Error("Evaluación incompleta.");
      }
      // 4. Snapshot sin la reserva; 5. secuencial, identidad, clave y comprobante RESERVED.
      const draftSnapshot = buildDebitNoteSnapshot({
        invoice: {
          id: invoice.id,
          documentNumber: invoice.documentNumber,
          issueDate: invoice.issueDate,
          accessKey: invoice.accessKey,
          environment: invoice.environment,
          authorization: invoice.authorization,
          snapshotVersion: invoice.snapshotVersion,
          buyer: invoice.buyer,
          treatments: context.treatments,
        },
        config,
        point,
        schema: {
          documentType: "05",
          version: schema.version,
          path: schema.path,
          sha256: schema.sha256,
          imports: schema.imports.map(({ path, sha256 }) => ({ path, sha256 })),
        },
        builderVersion: deps.builderVersion,
        datasetVersions: await scope.reads.datasetVersions(),
        issueDate,
        concepts: evaluation.concepts,
        amounts: evaluation.amounts,
        payment: evaluation.payment,
        declarations: {
          version: input.declarations.version,
          statements: [
            ...input.declarations.statements,
          ].sort() as DebitNoteSnapshot["declarations"]["statements"],
          declaredBy: ctx.userId,
          declaredAt: now().toISOString(),
          basis: "USER_DECLARED",
        },
      });
      const { document, snapshot } = await reserveDocumentIn(scope, deps.accessKeys, {
        companyId: ctx.companyId,
        documentType: "05",
        issueDate,
        environment: draftSnapshot.environment,
        environmentCode: draftSnapshot.environmentCode,
        ruc: draftSnapshot.issuer.ruc,
        establishment: draftSnapshot.issuer.establishment,
        emissionPoint: draftSnapshot.issuer.emissionPoint,
        reservedBy: ctx.userId,
        correlationId: ctx.requestId,
        withKey: (built): DebitNoteSnapshot => withDebitNoteKey(draftSnapshot, built),
        columns: (built) => ({
          schemaVersion: built.schema.version,
          buyerIdentification: built.buyer.identification,
          buyerName: built.buyer.legalName,
          total: built.totals.total,
        }),
      });
      // 6. La factura de la nota (la base comprueba que sea una factura autorizada de la misma
      // empresa y del mismo ambiente, y que la nota no se confirme sin ella).
      await scope.recordSupport(ctx.companyId, document.id, invoice.id);
      // 7. Borrador EMITTED, registro de idempotencia y auditoría, sin XML, SOAP ni descripciones.
      await scope.markDraftEmitted(ctx.companyId, draft.id, document.id, ctx.userId);
      await scope.idempotency.insert({
        companyId: ctx.companyId,
        operation: DEBIT_NOTE_EMIT_OPERATION,
        key,
        fingerprint,
        documentId: document.id,
        createdBy: ctx.userId,
      });
      await scope.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "debit_note.reserved",
        changes: {
          debitNoteId: document.id,
          documentNumber: document.documentNumber,
          accessKey: snapshot.key.accessKey,
          environment: document.environment,
          total: document.total,
          invoiceId: invoice.id,
          invoiceNumber: invoice.documentNumber,
          causes: causesOf(snapshot),
          conceptCount: snapshot.concepts.length,
          declarationVersion: snapshot.declarations.version,
          declarations: [...snapshot.declarations.statements],
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
    ): Promise<DebitNoteEmissionResult> {
      deps.authorizer.requirePermission(ctx, "debitNotes.emit");
      const key = readIdempotencyKey(idempotencyKey);
      const input = parseInput(emitDebitNoteSchema, body);
      const draft = await deps.drafts.find(ctx.companyId, input.draftId);
      if (!draft) throw draftNotFound();
      const fingerprint = debitNoteFingerprint(input, draft);
      const existing = await resolveExisting(ctx, key, fingerprint, timings);
      if (existing) return existing;
      if (draft.status === "EMITTED") throw new DraftAlreadyEmittedError(draft.documentId);
      if (draft.version !== input.expectedVersion) throw draftChanged();
      // La fecha de emisión se captura una sola vez y viaja como argumento.
      const issueDate = deps.today();
      await ensureSchema();
      // Comprobación previa fuera de la transacción: un rechazo no consume nada (design D4).
      const invoice = await deps.context.invoices.find(ctx.companyId, draft.invoiceId);
      if (!invoice) throw invoiceNotFound();
      const preliminary = await loadDebitContext(
        deps.context,
        ctx.companyId,
        invoice,
        draft,
        issueDate,
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
      const snapshot = document.snapshot as DebitNoteSnapshot;
      deps.observer?.reserved(snapshot.concepts.map((concept) => concept.cause));
      return { document: await continueToSigned(ctx, document, timings), replayed: false };
    },
  };
}

export type DebitNoteEmission = ReturnType<typeof createDebitNoteEmission>;

// Emisión de un comprobante de retención desde su borrador (add-withholding-receipts, design D12,
// D14, D15, D16, D23 y D26). Fuera de la transacción: permiso, cabecera Idempotency-Key, el borrador
// de la empresa, la huella canónica y la repetición en el registro, los archivos del esquema y la
// comprobación previa completa, sin consumir secuencial, clave, firma ni llamada al SRI. Dentro, sin
// I/O externo: borrador bloqueado, configuración bloqueada, el tercero y los catálogos leídos y
// evaluados otra vez con la fecha de la reserva, el snapshot autosuficiente, la reserva compartida de
// `fiscal` (secuencial, identidad, clave, comprobante RESERVED y su transición), el registro del
// comprobante con sus líneas, el borrador EMITTED, el registro de idempotencia y la auditoría. Todo o
// nada. Los documentos sustento son externos: no hay recursos compartidos que bloquear. Después del
// commit, la firma con el perfil de la retención.
import {
  emitWithholdingReceiptSchema,
  type WithholdingIssue,
  type WithholdingLimits,
} from "@facturador/contracts";
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
import { buildWithholdingSnapshot } from "../domain/build-snapshot.ts";
import type { WithholdingDraftRecord } from "../domain/draft.ts";
import { withWithholdingKey, type WithholdingSnapshot } from "../domain/snapshot.ts";
import {
  WITHHOLDING_SCHEMA,
  loadWithholdingContext,
  type ContextReads,
  type WithholdingContext,
} from "./context.ts";
import {
  DraftAlreadyEmittedError,
  WithholdingRejectedError,
  draftChanged,
  draftNotFound,
} from "./errors.ts";
import type { WithholdingEmissionUnitOfWork, WithholdingReceiptRecord } from "./ports.ts";

export const WITHHOLDING_EMIT_OPERATION = "withholding_receipt.emit" as const;

export type WithholdingEmissionObserver = Readonly<{
  /** Una reserva confirmada, con el impuesto (`1` renta, `2` IVA) de cada retención. */
  reserved(taxes: readonly string[]): void;
}>;

/** El borrador ya estaba emitido al bloquearlo: se resuelve fuera de la transacción revertida. */
class DraftEmittedSignal extends Error {
  readonly documentId: string | null;
  constructor(documentId: string | null) {
    super("El borrador ya está emitido.");
    this.documentId = documentId;
  }
}

export type WithholdingEmissionResult = Readonly<{ document: StoredDocument; replayed: boolean }>;

export type ContinueToSigned = (
  ctx: RequestContext,
  document: StoredDocument,
  timings?: StageTimings,
) => Promise<StoredDocument>;

export type WithholdingEmissionDependencies = {
  uow: WithholdingEmissionUnitOfWork;
  /** Lecturas sobre la conexión para la comprobación previa. */
  context: ContextReads;
  drafts: Readonly<{
    find(companyId: string, draftId: string): Promise<WithholdingDraftRecord | null>;
  }>;
  idempotency: IdempotencyStore;
  documents: DocumentRepository;
  accessKeys: AccessKeys;
  xsd: Pick<XsdValidator, "ensureAvailable">;
  builderVersion: string;
  authorizer: Authorizer;
  /** Límites efectivos de recursos (`WITHHOLDING_MAX_*`). */
  limits: WithholdingLimits;
  /** Reloj de la fecha de emisión, capturada una vez en America/Guayaquil. */
  today: () => string;
  now?: () => Date;
  continueToSigned?: ContinueToSigned;
  observer?: WithholdingEmissionObserver;
};

type EmitInput = Readonly<{ draftId: string; expectedVersion: number }>;

const first = (context: WithholdingContext): WithholdingIssue | undefined =>
  context.evaluation.issues[0];

/**
 * Huella canónica de la emisión (design D16): el borrador, su versión y los datos funcionales de esa
 * versión (proveedor, parte relacionada, período, punto y cada documento en orden con todos sus
 * campos, impuestos, pagos y retenciones), con posiciones explícitas. Una versión del borrador es
 * inmutable, así que la huella de una repetición coincide; otros datos nunca repiten un comprobante.
 */
export const withholdingFingerprint = (input: EmitInput, draft: WithholdingDraftRecord) =>
  requestFingerprint(WITHHOLDING_EMIT_OPERATION, {
    draftId: input.draftId,
    expectedVersion: input.expectedVersion,
    functional: {
      partyId: draft.partyId,
      relatedParty: draft.relatedParty,
      fiscalPeriod: draft.fiscalPeriod,
      emissionPointId: draft.emissionPointId,
      supports: draft.supports.map((support, index) => ({
        position: index + 1,
        documentType: support.documentType,
        supportCode: support.supportCode,
        number: support.number,
        issueDate: support.issueDate,
        authorizationNumber: support.authorizationNumber,
        totalWithoutTaxes: support.totalWithoutTaxes,
        importTotal: support.importTotal,
        taxes: support.taxes.map((tax, position) => ({ position: position + 1, ...tax })),
        payments: support.payments.map((payment, position) => ({
          position: position + 1,
          ...payment,
        })),
        withholdings: support.withholdings.map((item, position) => ({
          position: position + 1,
          tax: item.tax,
          entryKey: item.entryKey,
          base: item.base,
        })),
      })),
    },
  });

/** Registro y líneas del comprobante desde su snapshot (design D28). */
function recordOf(
  document: StoredDocument,
  snapshot: WithholdingSnapshot,
): WithholdingReceiptRecord {
  return {
    documentId: document.id,
    partyId: snapshot.subject.partyId,
    relatedParty: snapshot.relatedParty.value,
    fiscalPeriod: snapshot.fiscalPeriod,
    lines: snapshot.supports.flatMap((support) =>
      support.withholdings.map((item) => ({
        supportPosition: support.position,
        position: item.position,
        supportDocumentType: support.documentType.code,
        supportCode: support.supportCode.code,
        supportNumber: support.number,
        supportIssueDate: support.issueDate,
        tax: item.tax,
        withholdingCode: item.code,
        entryKey: item.ref.entryKey,
        base: item.base,
        percentage: item.percentage,
        amount: item.amount,
      })),
    ),
  };
}

export function createWithholdingEmission(deps: WithholdingEmissionDependencies) {
  const now = deps.now ?? (() => new Date());
  const continueToSigned: ContinueToSigned =
    deps.continueToSigned ?? ((_ctx, document) => Promise.resolve(document));

  /** Rechazo antes de reservar: el primer problema de la evaluación. */
  function reject(found: WithholdingIssue): never {
    throw new WithholdingRejectedError(found);
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
  ): Promise<WithholdingEmissionResult | null> {
    const record = await deps.idempotency.find(ctx.companyId, WITHHOLDING_EMIT_OPERATION, key);
    if (!record) return null;
    if (record.fingerprint !== fingerprint) throw idempotencyKeyReused();
    return replay(ctx, record.documentId, timings);
  }

  /** Archivos del esquema disponibles con su hash, antes de abrir la transacción. */
  async function ensureSchema(): Promise<void> {
    const schema = registeredSchema(
      await deps.context.reads.schemaRegistry(),
      WITHHOLDING_SCHEMA.documentType,
      WITHHOLDING_SCHEMA.version,
    );
    if (!schema) return;
    try {
      await deps.xsd.ensureAvailable(schema);
    } catch {
      throw new WithholdingRejectedError({
        code: "SCHEMA_NOT_AVAILABLE",
        message:
          "El esquema XSD del comprobante de retención 2.0.0 o uno de sus imports falta o no coincide con su hash.",
        support: null,
        tax: null,
        payment: null,
        withholding: null,
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
      // 3. El tercero y los catálogos otra vez, con la fecha de la reserva, y la evaluación.
      const context = await loadWithholdingContext(
        scope,
        ctx.companyId,
        draft,
        issueDate,
        deps.limits,
      );
      const issue = first(context);
      if (issue) reject(issue);
      const { config, point, schema, subject, evaluation } = context;
      if (
        !config ||
        !point ||
        !schema ||
        !subject ||
        !evaluation.amounts ||
        draft.relatedParty === null ||
        draft.fiscalPeriod === null
      ) {
        throw new Error("Evaluación incompleta.");
      }
      // 4. Snapshot sin la reserva; 5. secuencial, identidad, clave y comprobante RESERVED.
      const draftSnapshot = buildWithholdingSnapshot({
        subject,
        relatedParty: draft.relatedParty,
        fiscalPeriod: draft.fiscalPeriod,
        declared: {
          by: ctx.userId,
          byName: await scope.userName(ctx.companyId, ctx.userId),
          at: now(),
        },
        supports: evaluation.supports,
        amounts: evaluation.amounts,
        config,
        point,
        schema: {
          documentType: "07",
          version: schema.version,
          path: schema.path,
          sha256: schema.sha256,
          imports: schema.imports.map(({ path, sha256 }) => ({ path, sha256 })),
        },
        builderVersion: deps.builderVersion,
        datasetVersions: await scope.reads.datasetVersions(),
        issueDate,
      });
      const { document, snapshot } = await reserveDocumentIn(scope, deps.accessKeys, {
        companyId: ctx.companyId,
        documentType: "07",
        issueDate,
        environment: draftSnapshot.environment,
        environmentCode: draftSnapshot.environmentCode,
        ruc: draftSnapshot.issuer.ruc,
        establishment: draftSnapshot.issuer.establishment,
        emissionPoint: draftSnapshot.issuer.emissionPoint,
        reservedBy: ctx.userId,
        correlationId: ctx.requestId,
        withKey: (built): WithholdingSnapshot => withWithholdingKey(draftSnapshot, built),
        columns: (built) => ({
          receiver: "BUYER",
          schemaVersion: built.schema.version,
          buyerIdentification: built.subject.identification,
          buyerName: built.subject.legalName,
          total: built.totals.withheld,
        }),
      });
      // 6. El registro del comprobante y sus líneas (la base exige un 07 de la empresa, y que no se
      // confirme sin ellos).
      await scope.recordReceipt(ctx.companyId, recordOf(document, snapshot));
      // 7. Borrador EMITTED, registro de idempotencia y auditoría, sin XML ni SOAP.
      await scope.markDraftEmitted(ctx.companyId, draft.id, document.id, ctx.userId);
      await scope.idempotency.insert({
        companyId: ctx.companyId,
        operation: WITHHOLDING_EMIT_OPERATION,
        key,
        fingerprint,
        documentId: document.id,
        createdBy: ctx.userId,
      });
      const items = snapshot.supports.flatMap((support) => support.withholdings);
      await scope.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "withholding_receipt.reserved",
        changes: {
          withholdingReceiptId: document.id,
          documentNumber: document.documentNumber,
          accessKey: snapshot.key.accessKey,
          environment: document.environment,
          totalWithheld: snapshot.totals.withheld,
          subjectIdentification: snapshot.subject.identification,
          subjectName: snapshot.subject.legalName,
          fiscalPeriod: snapshot.fiscalPeriod,
          relatedParty: snapshot.relatedParty.value,
          relatedPartyBasis: snapshot.relatedParty.basis,
          supportCount: snapshot.supports.length,
          withholdingCount: items.length,
          taxes: [...new Set(items.map((item) => item.tax))].sort(),
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
    ): Promise<WithholdingEmissionResult> {
      deps.authorizer.requirePermission(ctx, "withholdings.emit");
      const key = readIdempotencyKey(idempotencyKey);
      const input = parseInput(emitWithholdingReceiptSchema, body);
      const draft = await deps.drafts.find(ctx.companyId, input.draftId);
      if (!draft) throw draftNotFound();
      const fingerprint = withholdingFingerprint(input, draft);
      const existing = await resolveExisting(ctx, key, fingerprint, timings);
      if (existing) return existing;
      if (draft.status === "EMITTED") throw new DraftAlreadyEmittedError(draft.documentId);
      if (draft.version !== input.expectedVersion) throw draftChanged();
      // La fecha de emisión se captura una sola vez y viaja como argumento (design D12).
      const issueDate = deps.today();
      await ensureSchema();
      // Comprobación previa fuera de la transacción: un rechazo no consume nada (design D15).
      const preliminary = await loadWithholdingContext(
        deps.context,
        ctx.companyId,
        draft,
        issueDate,
        deps.limits,
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
      const snapshot = document.snapshot as WithholdingSnapshot;
      deps.observer?.reserved(
        snapshot.supports.flatMap((support) => support.withholdings.map((item) => item.tax)),
      );
      return { document: await continueToSigned(ctx, document, timings), replayed: false };
    },
  };
}

export type WithholdingEmission = ReturnType<typeof createWithholdingEmission>;

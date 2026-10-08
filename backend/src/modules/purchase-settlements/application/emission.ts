// Emisión de una liquidación de compra desde su borrador (add-purchase-settlements, design D3, D12 a
// D14, D23 y D26). Fuera de la transacción: permiso, cabecera Idempotency-Key, el borrador de la
// empresa, la huella canónica y la repetición en el registro, los archivos del esquema, la evaluación
// completa y las cuatro declaraciones de procedencia con la versión vigente de la política, sin
// consumir secuencial, clave, firma ni llamada al SRI. Dentro, sin I/O externo: borrador bloqueado,
// configuración bloqueada, el proveedor, los productos y los catálogos leídos y evaluados otra vez con
// la fecha de la reserva, el snapshot autosuficiente con las declaraciones congeladas (quien emite y
// el momento), la reserva compartida de `fiscal` con el proveedor como contraparte (`BUYER`), el
// registro de la liquidación con sus cuatro declaraciones, el borrador EMITTED, el registro de
// idempotencia y la auditoría. Todo o nada. Sin inventario, compras ni retenciones. Después del
// commit, la firma con el perfil de la liquidación.
import {
  PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY,
  PURCHASE_SETTLEMENT_STATEMENTS,
  PURCHASE_SETTLEMENT_STATEMENT_TEXTS,
  emitPurchaseSettlementSchema,
  type PurchaseSettlementIssue,
  type PurchaseSettlementLimits,
  type PurchaseSettlementStatement,
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
import { buildPurchaseSettlementSnapshot } from "../domain/build-snapshot.ts";
import type { PurchaseSettlementDraftRecord } from "../domain/draft.ts";
import type { PurchaseSettlementEvaluation } from "../domain/evaluation.ts";
import { withPurchaseSettlementKey, type PurchaseSettlementSnapshot } from "../domain/snapshot.ts";
import {
  PURCHASE_SETTLEMENT_SCHEMA,
  loadPurchaseSettlementContext,
  type ContextReads,
} from "./context.ts";
import {
  DraftAlreadyEmittedError,
  PurchaseSettlementRejectedError,
  draftChanged,
  draftNotFound,
} from "./errors.ts";
import type { PurchaseSettlementEmissionUnitOfWork, PurchaseSettlementRecord } from "./ports.ts";

export const PURCHASE_SETTLEMENT_EMIT_OPERATION = "purchase_settlement.emit" as const;

export type PurchaseSettlementEmissionObserver = Readonly<{
  /** Una reserva confirmada. */
  reserved(): void;
}>;

/** El borrador ya estaba emitido al bloquearlo: se resuelve fuera de la transacción revertida. */
class DraftEmittedSignal extends Error {
  readonly documentId: string | null;
  constructor(documentId: string | null) {
    super("El borrador ya está emitido.");
    this.documentId = documentId;
  }
}

export type PurchaseSettlementEmissionResult = Readonly<{
  document: StoredDocument;
  replayed: boolean;
}>;

export type ContinueToSigned = (
  ctx: RequestContext,
  document: StoredDocument,
  timings?: StageTimings,
) => Promise<StoredDocument>;

export type PurchaseSettlementEmissionDependencies = {
  uow: PurchaseSettlementEmissionUnitOfWork;
  /** Lecturas sobre la conexión para la comprobación previa. */
  context: ContextReads;
  drafts: Readonly<{
    find(companyId: string, draftId: string): Promise<PurchaseSettlementDraftRecord | null>;
  }>;
  idempotency: IdempotencyStore;
  documents: DocumentRepository;
  accessKeys: AccessKeys;
  xsd: Pick<XsdValidator, "ensureAvailable">;
  builderVersion: string;
  authorizer: Authorizer;
  /** Límites efectivos de recursos (`PURCHASE_SETTLEMENT_MAX_*`). */
  limits: PurchaseSettlementLimits;
  /** Reloj de la fecha de emisión, capturada una vez en America/Guayaquil. */
  today: () => string;
  now?: () => Date;
  continueToSigned?: ContinueToSigned;
  observer?: PurchaseSettlementEmissionObserver;
};

type EmitInput = Readonly<{
  draftId: string;
  expectedVersion: number;
  declarations: Readonly<{
    policyVersion: number;
    statements: readonly PurchaseSettlementStatement[];
  }>;
}>;

const rejection = (
  code: PurchaseSettlementIssue["code"],
  message: string,
): PurchaseSettlementIssue => ({
  code,
  message,
  field: "declarations",
  line: null,
  payment: null,
});

/**
 * Las cuatro declaraciones de procedencia (design D3): la versión vigente de la política y el
 * conjunto exacto de sus cuatro identificadores, sin repetidos. Informa la primera que falta.
 */
export function declarationIssue(
  declarations: EmitInput["declarations"],
): PurchaseSettlementIssue | null {
  if (declarations.policyVersion !== PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.version) {
    return rejection(
      "PURCHASE_SETTLEMENT_DECLARATION_VERSION_MISMATCH",
      `Las declaraciones citan la versión ${declarations.policyVersion} de la política de procedencia y la vigente es la ${PURCHASE_SETTLEMENT_ELIGIBILITY_POLICY.version}. Recarga el borrador y confírmalas otra vez.`,
    );
  }
  const confirmed = new Set(declarations.statements);
  const missing = PURCHASE_SETTLEMENT_STATEMENTS.find((statement) => !confirmed.has(statement));
  if (missing) {
    return rejection(
      "PURCHASE_SETTLEMENT_DECLARATION_REQUIRED",
      `Confirma cada declaración de procedencia del caso c) del art. 13. Falta: "${PURCHASE_SETTLEMENT_STATEMENT_TEXTS[missing]}"`,
    );
  }
  if (confirmed.size !== declarations.statements.length) {
    return rejection(
      "PURCHASE_SETTLEMENT_DECLARATION_REQUIRED",
      "Cada declaración de procedencia se confirma una sola vez.",
    );
  }
  return null;
}

/**
 * Huella canónica de la emisión (design D14): el borrador, su versión, los datos funcionales de esa
 * versión (punto, proveedor, dirección, líneas y pagos en orden, con posiciones explícitas) y las
 * declaraciones con la versión de su política, porque cambian la evidencia de la emisión. Una
 * versión del borrador es inmutable, así que la huella de una repetición coincide.
 */
export const purchaseSettlementFingerprint = (
  input: EmitInput,
  draft: PurchaseSettlementDraftRecord,
) =>
  requestFingerprint(PURCHASE_SETTLEMENT_EMIT_OPERATION, {
    draftId: input.draftId,
    expectedVersion: input.expectedVersion,
    declarations: {
      policyVersion: input.declarations.policyVersion,
      statements: [...input.declarations.statements].sort(),
    },
    functional: {
      emissionPointId: draft.emissionPointId,
      supplierPartyId: draft.supplierPartyId,
      supplierAddress: draft.supplierAddress,
      lines: draft.lines.map((line, index) => ({
        position: index + 1,
        productId: line.productId,
        mainCode: line.mainCode,
        auxiliaryCode: line.auxiliaryCode,
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        ivaRate: line.ivaRate,
      })),
      payments: draft.payments.map((payment, index) => ({
        position: index + 1,
        paymentMethod: payment.paymentMethod,
        total: payment.total,
        term: payment.term,
        timeUnit: payment.timeUnit,
      })),
    },
  });

/** Registro de la liquidación y de sus cuatro declaraciones desde su snapshot (design D25). */
function recordOf(
  document: StoredDocument,
  snapshot: PurchaseSettlementSnapshot,
): PurchaseSettlementRecord {
  return {
    documentId: document.id,
    supplierPartyId: snapshot.supplier.partyId,
    eligibilityCase: snapshot.eligibility.case,
    eligibilityPolicy: snapshot.eligibility.policy,
    policyVersion: snapshot.eligibility.policyVersion,
    lineCount: snapshot.counts.lines,
    paymentCount: snapshot.counts.payments,
    declarations: snapshot.eligibility.declarations.map((declaration) => ({
      statementId: declaration.statementId,
      policyVersion: declaration.policyVersion,
      basis: declaration.basis,
      declaredBy: declaration.declaredBy,
      declaredAt: new Date(declaration.declaredAt),
    })),
  };
}

export function createPurchaseSettlementEmission(deps: PurchaseSettlementEmissionDependencies) {
  const now = deps.now ?? (() => new Date());
  const continueToSigned: ContinueToSigned =
    deps.continueToSigned ?? ((_ctx, document) => Promise.resolve(document));

  /** Rechazo antes de reservar: el primer problema de la evaluación o de las declaraciones. */
  function check(evaluation: PurchaseSettlementEvaluation, input: EmitInput): void {
    const found = evaluation.issues[0] ?? declarationIssue(input.declarations);
    if (found) throw new PurchaseSettlementRejectedError(found);
  }

  async function replay(ctx: RequestContext, documentId: string, timings: StageTimings) {
    const document = await deps.documents.find(ctx.companyId, documentId);
    if (!document) {
      throw new Error("El registro de idempotencia apunta a un comprobante inexistente.");
    }
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
  ): Promise<PurchaseSettlementEmissionResult | null> {
    const record = await deps.idempotency.find(
      ctx.companyId,
      PURCHASE_SETTLEMENT_EMIT_OPERATION,
      key,
    );
    if (!record) return null;
    if (record.fingerprint !== fingerprint) throw idempotencyKeyReused();
    return replay(ctx, record.documentId, timings);
  }

  /** Archivos del esquema disponibles con su hash, antes de abrir la transacción. */
  async function ensureSchema(): Promise<void> {
    const schema = registeredSchema(
      await deps.context.reads.schemaRegistry(),
      PURCHASE_SETTLEMENT_SCHEMA.documentType,
      PURCHASE_SETTLEMENT_SCHEMA.version,
    );
    if (!schema) return;
    try {
      await deps.xsd.ensureAvailable(schema);
    } catch {
      throw new PurchaseSettlementRejectedError({
        code: "SCHEMA_NOT_AVAILABLE",
        message:
          "El esquema XSD de la liquidación de compra 1.1.0 falta o no coincide con su hash registrado.",
        field: null,
        line: null,
        payment: null,
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
      // 3. Proveedor, productos y catálogos otra vez, con la fecha de la reserva.
      const context = await loadPurchaseSettlementContext(
        scope,
        ctx.companyId,
        draft,
        issueDate,
        deps.limits,
      );
      check(context.evaluation, input);
      const { config, point, schema, evaluation } = context;
      if (!config || !point || !schema || !evaluation.supplier || !evaluation.amounts) {
        throw new Error("Evaluación incompleta.");
      }
      if (evaluation.address === null) throw new Error("Evaluación incompleta.");
      // 4. Snapshot sin la reserva, con las declaraciones congeladas: quien emite, ahora.
      const draftSnapshot = buildPurchaseSettlementSnapshot({
        supplier: evaluation.supplier,
        address: evaluation.address,
        lines: evaluation.lines,
        payments: evaluation.payments,
        amounts: evaluation.amounts,
        declared: {
          by: ctx.userId,
          byName: await scope.userName(ctx.companyId, ctx.userId),
          at: now(),
        },
        config,
        point,
        schema: {
          documentType: "03",
          version: schema.version,
          path: schema.path,
          sha256: schema.sha256,
          imports: schema.imports.map(({ path, sha256 }) => ({ path, sha256 })),
        },
        builderVersion: deps.builderVersion,
        datasetVersions: await scope.reads.datasetVersions(),
        issueDate,
      });
      // 5. Secuencial propio del 03, identidad, clave y comprobante RESERVED con el proveedor como
      // contraparte y el importe total (design D2 y D20).
      const { document, snapshot } = await reserveDocumentIn(scope, deps.accessKeys, {
        companyId: ctx.companyId,
        documentType: "03",
        issueDate,
        environment: draftSnapshot.environment,
        environmentCode: draftSnapshot.environmentCode,
        ruc: draftSnapshot.issuer.ruc,
        establishment: draftSnapshot.issuer.establishment,
        emissionPoint: draftSnapshot.issuer.emissionPoint,
        reservedBy: ctx.userId,
        correlationId: ctx.requestId,
        withKey: (built): PurchaseSettlementSnapshot =>
          withPurchaseSettlementKey(draftSnapshot, built),
        columns: (built) => ({
          receiver: "BUYER",
          schemaVersion: built.schema.version,
          buyerIdentification: built.supplier.identification,
          buyerName: built.supplier.legalName,
          total: built.totals.total,
        }),
      });
      // 6. El registro de la liquidación y sus cuatro declaraciones (la base exige un 03 de la
      // empresa, y que no se confirme sin ellos).
      await scope.recordSettlement(ctx.companyId, recordOf(document, snapshot));
      // 7. Borrador EMITTED, registro de idempotencia y auditoría, sin descripciones, direcciones,
      // XML ni SOAP (design D23).
      await scope.markDraftEmitted(ctx.companyId, draft.id, document.id, ctx.userId);
      await scope.idempotency.insert({
        companyId: ctx.companyId,
        operation: PURCHASE_SETTLEMENT_EMIT_OPERATION,
        key,
        fingerprint,
        documentId: document.id,
        createdBy: ctx.userId,
      });
      await scope.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "purchase_settlement.reserved",
        changes: {
          purchaseSettlementId: document.id,
          documentNumber: document.documentNumber,
          accessKey: snapshot.key.accessKey,
          environment: document.environment,
          eligibilityCase: snapshot.eligibility.case,
          eligibilityPolicy: snapshot.eligibility.policy,
          policyVersion: snapshot.eligibility.policyVersion,
          statements: snapshot.eligibility.declarations.map((item) => item.statementId),
          lineCount: snapshot.counts.lines,
          paymentCount: snapshot.counts.payments,
          total: snapshot.totals.total,
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
    ): Promise<PurchaseSettlementEmissionResult> {
      deps.authorizer.requirePermission(ctx, "purchaseSettlements.emit");
      const key = readIdempotencyKey(idempotencyKey);
      const input = parseInput(emitPurchaseSettlementSchema, body);
      const draft = await deps.drafts.find(ctx.companyId, input.draftId);
      if (!draft) throw draftNotFound();
      const fingerprint = purchaseSettlementFingerprint(input, draft);
      const existing = await resolveExisting(ctx, key, fingerprint, timings);
      if (existing) return existing;
      if (draft.status === "EMITTED") throw new DraftAlreadyEmittedError(draft.documentId);
      if (draft.version !== input.expectedVersion) throw draftChanged();
      // La fecha de emisión se captura una sola vez y viaja como argumento.
      const issueDate = deps.today();
      await ensureSchema();
      // Comprobación previa fuera de la transacción: un rechazo no consume nada (design D13).
      const preliminary = await loadPurchaseSettlementContext(
        deps.context,
        ctx.companyId,
        draft,
        issueDate,
        deps.limits,
      );
      check(preliminary.evaluation, input);

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
      deps.observer?.reserved();
      return { document: await continueToSigned(ctx, document, timings), replayed: false };
    },
  };
}

export type PurchaseSettlementEmission = ReturnType<typeof createPurchaseSettlementEmission>;

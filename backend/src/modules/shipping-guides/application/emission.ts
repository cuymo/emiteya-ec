// Emisión de una guía de remisión desde su borrador (add-shipping-guides, design D12 a D15, D24 y
// D27). Fuera de la transacción: permiso, cabecera Idempotency-Key, el borrador de la empresa, la
// huella canónica y la repetición en el registro, los archivos del esquema, la evaluación completa y
// la declaración de las excepciones, sin consumir secuencial, clave, firma ni llamada al SRI. Dentro,
// sin I/O externo: borrador bloqueado, configuración bloqueada, terceros, establecimientos, productos
// y facturas leídos y evaluados otra vez con la fecha de la reserva, el snapshot autosuficiente con la
// declaración congelada por destinatario, la reserva compartida de `fiscal` con los destinatarios
// (`RECIPIENTS`), el registro de la guía con sus destinatarios, el borrador EMITTED, el registro de
// idempotencia y la auditoría. Todo o nada. Las facturas sustento no tienen capacidad que consumir:
// dos guías sobre la misma factura son válidas a la vez. Después del commit, la firma con el perfil
// de la guía.
import {
  SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION,
  emitShippingGuideSchema,
  type ShippingGuideIssue,
  type ShippingGuideLimits,
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
import { buildShippingGuideSnapshot } from "../domain/build-snapshot.ts";
import type { ShippingGuideDraftRecord } from "../domain/draft.ts";
import type { ShippingGuideEvaluation } from "../domain/evaluation.ts";
import { withShippingGuideKey, type ShippingGuideSnapshot } from "../domain/snapshot.ts";
import { SHIPPING_GUIDE_SCHEMA, loadShippingGuideContext, type ContextReads } from "./context.ts";
import {
  DraftAlreadyEmittedError,
  ShippingGuideRejectedError,
  draftChanged,
  draftNotFound,
} from "./errors.ts";
import type { ShippingGuideEmissionUnitOfWork, ShippingGuideRecord } from "./ports.ts";

export const SHIPPING_GUIDE_EMIT_OPERATION = "shipping_guide.emit" as const;

export type ShippingGuideEmissionObserver = Readonly<{
  /** Una reserva confirmada, con la clase de sustento de cada destinatario. */
  reserved(supports: readonly ("INTERNAL_INVOICE" | "DECLARED_EXCEPTION")[]): void;
}>;

/** El borrador ya estaba emitido al bloquearlo: se resuelve fuera de la transacción revertida. */
class DraftEmittedSignal extends Error {
  readonly documentId: string | null;
  constructor(documentId: string | null) {
    super("El borrador ya está emitido.");
    this.documentId = documentId;
  }
}

export type ShippingGuideEmissionResult = Readonly<{
  document: StoredDocument;
  replayed: boolean;
}>;

export type ContinueToSigned = (
  ctx: RequestContext,
  document: StoredDocument,
  timings?: StageTimings,
) => Promise<StoredDocument>;

export type ShippingGuideEmissionDependencies = {
  uow: ShippingGuideEmissionUnitOfWork;
  /** Lecturas sobre la conexión para la comprobación previa. */
  context: ContextReads;
  drafts: Readonly<{
    find(companyId: string, draftId: string): Promise<ShippingGuideDraftRecord | null>;
  }>;
  idempotency: IdempotencyStore;
  documents: DocumentRepository;
  accessKeys: AccessKeys;
  xsd: Pick<XsdValidator, "ensureAvailable">;
  builderVersion: string;
  authorizer: Authorizer;
  /** Límites efectivos de recursos (`SHIPPING_GUIDE_MAX_*`). */
  limits: ShippingGuideLimits;
  /** Reloj de la fecha de emisión, capturada una vez en America/Guayaquil. */
  today: () => string;
  now?: () => Date;
  continueToSigned?: ContinueToSigned;
  observer?: ShippingGuideEmissionObserver;
};

type EmitInput = Readonly<{
  draftId: string;
  expectedVersion: number;
  exceptionDeclaration: Readonly<{ policyVersion: number }> | null;
}>;

const rejection = (code: ShippingGuideIssue["code"], message: string): ShippingGuideIssue => ({
  code,
  message,
  field: "exceptionDeclaration",
  recipient: null,
  detail: null,
});

/**
 * La declaración de las excepciones (design D14): obligatoria si algún destinatario declara una
 * excepción, con la versión vigente de la política; nula si ninguno la declara.
 */
export function declarationIssue(
  evaluation: ShippingGuideEvaluation,
  declaration: EmitInput["exceptionDeclaration"],
): ShippingGuideIssue | null {
  if (!evaluation.exceptionDeclarationRequired) {
    return declaration === null
      ? null
      : rejection(
          "SHIPPING_GUIDE_DECLARATION_NOT_APPLICABLE",
          "La guía no declara excepciones: la emisión no lleva la confirmación de una declaración.",
        );
  }
  if (declaration === null) {
    return rejection(
      "SHIPPING_GUIDE_DECLARATION_REQUIRED",
      "Confirma que los traslados sin factura corresponden a los casos declarados del art. 30 del Reglamento de Comprobantes.",
    );
  }
  if (declaration.policyVersion !== SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION) {
    return rejection(
      "SHIPPING_GUIDE_DECLARATION_VERSION_MISMATCH",
      `La declaración cita la versión ${declaration.policyVersion} de la política de excepciones y la vigente es la ${SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION}. Recarga el borrador y confírmala otra vez.`,
    );
  }
  return null;
}

/**
 * Huella canónica de la emisión (design D15): el borrador, su versión, los datos funcionales de esa
 * versión (punto, transportista, placa, partida con su origen, fechas y cada destinatario en orden
 * con su destinatario, sus textos, su sustento con su caso y sus detalles) y la confirmación de la
 * declaración con su versión, porque cambia el documento emitido. Posiciones explícitas.
 */
export const shippingGuideFingerprint = (input: EmitInput, draft: ShippingGuideDraftRecord) =>
  requestFingerprint(SHIPPING_GUIDE_EMIT_OPERATION, {
    draftId: input.draftId,
    expectedVersion: input.expectedVersion,
    exceptionDeclaration: input.exceptionDeclaration,
    functional: {
      emissionPointId: draft.emissionPointId,
      originEstablishmentId: draft.originEstablishmentId,
      departureAddress: draft.departureAddress,
      transporter: draft.transporter,
      plate: draft.plate,
      transportStart: draft.transportStart,
      transportEnd: draft.transportEnd,
      recipients: draft.recipients.map((recipient, index) => ({
        position: index + 1,
        recipient: recipient.recipient,
        address: recipient.address,
        motive: recipient.motive,
        route: recipient.route,
        destinationEstablishmentCode: recipient.destinationEstablishmentCode,
        support: recipient.support,
        details: recipient.details.map((detail, position) => ({
          position: position + 1,
          productId: detail.productId,
          mainCode: detail.mainCode,
          auxiliaryCode: detail.auxiliaryCode,
          description: detail.description,
          quantity: detail.quantity,
        })),
      })),
    },
  });

/** Registro de la guía y de sus destinatarios desde su snapshot (design D26). */
function recordOf(document: StoredDocument, snapshot: ShippingGuideSnapshot): ShippingGuideRecord {
  return {
    documentId: document.id,
    originEstablishmentId: snapshot.departure.establishment?.id ?? null,
    transporterSource: snapshot.transporter.source,
    carrierPartyId: snapshot.transporter.partyId,
    carrierIdentificationType: snapshot.transporter.identificationType,
    carrierIdentification: snapshot.transporter.identification,
    carrierName: snapshot.transporter.legalName,
    plate: snapshot.plate,
    transportStart: snapshot.transportStart,
    transportEnd: snapshot.transportEnd,
    recipientCount: snapshot.counts.recipients,
    detailCount: snapshot.counts.details,
    recipients: snapshot.recipients.map((recipient) => {
      const { support } = recipient;
      const declaration = support.kind === "DECLARED_EXCEPTION" ? support.declaration : null;
      return {
        position: recipient.position,
        recipientKind: recipient.kind,
        partyId: recipient.partyId,
        destinationEstablishmentId: recipient.destination?.id ?? null,
        supportKind: support.kind,
        invoiceId: support.kind === "INTERNAL_INVOICE" ? support.invoice.id : null,
        exceptionCase: declaration?.case ?? null,
        exceptionPolicyVersion: declaration?.policyVersion ?? null,
        declaredBy: declaration?.declaredBy ?? null,
        declaredAt: declaration ? new Date(declaration.declaredAt) : null,
        detailCount: recipient.details.length,
      };
    }),
  };
}

export function createShippingGuideEmission(deps: ShippingGuideEmissionDependencies) {
  const now = deps.now ?? (() => new Date());
  const continueToSigned: ContinueToSigned =
    deps.continueToSigned ?? ((_ctx, document) => Promise.resolve(document));

  /** Rechazo antes de reservar: el primer problema de la evaluación o de la declaración. */
  function check(evaluation: ShippingGuideEvaluation, input: EmitInput): void {
    const found = evaluation.issues[0] ?? declarationIssue(evaluation, input.exceptionDeclaration);
    if (found) throw new ShippingGuideRejectedError(found);
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
  ): Promise<ShippingGuideEmissionResult | null> {
    const record = await deps.idempotency.find(ctx.companyId, SHIPPING_GUIDE_EMIT_OPERATION, key);
    if (!record) return null;
    if (record.fingerprint !== fingerprint) throw idempotencyKeyReused();
    return replay(ctx, record.documentId, timings);
  }

  /** Archivos del esquema disponibles con su hash, antes de abrir la transacción. */
  async function ensureSchema(): Promise<void> {
    const schema = registeredSchema(
      await deps.context.reads.schemaRegistry(),
      SHIPPING_GUIDE_SCHEMA.documentType,
      SHIPPING_GUIDE_SCHEMA.version,
    );
    if (!schema) return;
    try {
      await deps.xsd.ensureAvailable(schema);
    } catch {
      throw new ShippingGuideRejectedError({
        code: "SCHEMA_NOT_AVAILABLE",
        message:
          "El esquema XSD de la guía de remisión 1.1.0 falta o no coincide con su hash registrado.",
        field: null,
        recipient: null,
        detail: null,
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
      // 3. Terceros, establecimientos, productos y facturas otra vez, con la fecha de la reserva.
      const context = await loadShippingGuideContext(
        scope,
        ctx.companyId,
        draft,
        issueDate,
        deps.limits,
      );
      check(context.evaluation, input);
      const { config, point, schema } = context;
      const { guide } = context.evaluation;
      if (!config || !point || !schema || !guide) throw new Error("Evaluación incompleta.");
      // 4. Snapshot sin la reserva, con la declaración congelada: el usuario que emite, ahora.
      const draftSnapshot = buildShippingGuideSnapshot({
        guide,
        declaration: context.evaluation.exceptionDeclarationRequired
          ? {
              policyVersion: SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION,
              by: ctx.userId,
              byName: await scope.userName(ctx.companyId, ctx.userId),
              at: now(),
            }
          : null,
        config,
        point,
        schema: {
          documentType: "06",
          version: schema.version,
          path: schema.path,
          sha256: schema.sha256,
          imports: schema.imports.map(({ path, sha256 }) => ({ path, sha256 })),
        },
        builderVersion: deps.builderVersion,
        datasetVersions: await scope.reads.datasetVersions(),
        issueDate,
      });
      // 5. Secuencial propio del 06, identidad, clave y comprobante RESERVED con sus destinatarios,
      // sin total ni comprador (design D10).
      const { document, snapshot } = await reserveDocumentIn(scope, deps.accessKeys, {
        companyId: ctx.companyId,
        documentType: "06",
        issueDate,
        environment: draftSnapshot.environment,
        environmentCode: draftSnapshot.environmentCode,
        ruc: draftSnapshot.issuer.ruc,
        establishment: draftSnapshot.issuer.establishment,
        emissionPoint: draftSnapshot.issuer.emissionPoint,
        reservedBy: ctx.userId,
        correlationId: ctx.requestId,
        withKey: (built): ShippingGuideSnapshot => withShippingGuideKey(draftSnapshot, built),
        columns: (built) => ({
          receiver: "RECIPIENTS",
          schemaVersion: built.schema.version,
          recipients: built.recipients.map((recipient) => ({
            identification: recipient.identification,
            name: recipient.legalName,
          })),
        }),
      });
      // 6. El registro de la guía y sus destinatarios (la base exige un 06 de la empresa, y que no
      // se confirme sin ellos).
      await scope.recordGuide(ctx.companyId, recordOf(document, snapshot));
      // 7. Borrador EMITTED, registro de idempotencia y auditoría, sin direcciones, descripciones,
      // placa, XML ni SOAP (design D24).
      await scope.markDraftEmitted(ctx.companyId, draft.id, document.id, ctx.userId);
      await scope.idempotency.insert({
        companyId: ctx.companyId,
        operation: SHIPPING_GUIDE_EMIT_OPERATION,
        key,
        fingerprint,
        documentId: document.id,
        createdBy: ctx.userId,
      });
      await scope.audit.append({
        companyId: ctx.companyId,
        actor: { type: "USER", userId: ctx.userId },
        action: "shipping_guide.reserved",
        changes: {
          shippingGuideId: document.id,
          documentNumber: document.documentNumber,
          accessKey: snapshot.key.accessKey,
          environment: document.environment,
          transporterSource: snapshot.transporter.source,
          carrierIdentification: snapshot.transporter.identification,
          carrierName: snapshot.transporter.legalName,
          recipientCount: snapshot.counts.recipients,
          detailCount: snapshot.counts.details,
          supportKinds: [...new Set(snapshot.recipients.map((item) => item.support.kind))].sort(),
          // Cada excepción declarada como "posición:caso", con la versión de la política.
          exceptions: snapshot.recipients.flatMap((recipient) =>
            recipient.support.kind === "DECLARED_EXCEPTION"
              ? [`${recipient.position}:${recipient.support.declaration.case}`]
              : [],
          ),
          exceptionPolicyVersion: context.evaluation.exceptionDeclarationRequired
            ? SHIPPING_GUIDE_EXCEPTION_POLICY_VERSION
            : null,
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
    ): Promise<ShippingGuideEmissionResult> {
      deps.authorizer.requirePermission(ctx, "shippingGuides.emit");
      const key = readIdempotencyKey(idempotencyKey);
      const input = parseInput(emitShippingGuideSchema, body);
      const draft = await deps.drafts.find(ctx.companyId, input.draftId);
      if (!draft) throw draftNotFound();
      const fingerprint = shippingGuideFingerprint(input, draft);
      const existing = await resolveExisting(ctx, key, fingerprint, timings);
      if (existing) return existing;
      if (draft.status === "EMITTED") throw new DraftAlreadyEmittedError(draft.documentId);
      if (draft.version !== input.expectedVersion) throw draftChanged();
      // La fecha de emisión se captura una sola vez y viaja como argumento.
      const issueDate = deps.today();
      await ensureSchema();
      // Comprobación previa fuera de la transacción: un rechazo no consume nada (design D13).
      const preliminary = await loadShippingGuideContext(
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
      const snapshot = document.snapshot as ShippingGuideSnapshot;
      deps.observer?.reserved(snapshot.recipients.map((recipient) => recipient.support.kind));
      return { document: await continueToSigned(ctx, document, timings), replayed: false };
    },
  };
}

export type ShippingGuideEmission = ReturnType<typeof createShippingGuideEmission>;

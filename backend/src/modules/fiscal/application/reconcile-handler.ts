// Reconciliación por clave (add-sri-transmission, design D4, D12, D13 y D15): un solo caso de uso,
// `reconcileDocument`, para el job automático y para la reconciliación manual del administrador.
//
// 1. La autorización por clave decide primero, con las reglas de D12.
// 2. Solo si el SRI no conoce la clave, la consulta de validez actúa como guarda: un estado
//    informado impide el reenvío; nunca lo autoriza.
// 3. Sin evidencia de que el SRI conozca la clave: con evidencia de recepción (RECIBIDA, 70 o 43)
//    se sigue consultando dentro de la ventana; con la causa 45, revisión manual; sin ninguna, se
//    reenvían los mismos bytes. Desde `MANUAL_REVIEW` nunca se reenvía: sin conclusión, permanece.
//
// Nunca reserva otro número ni cambia la clave o el contenido.
import type { AuditAction, AuditEventInput } from "../../audit/domain/audit-event.ts";
import type { Job, JobError } from "../../../platform/jobs/jobs.ts";
import type { JobHandler } from "../../../platform/jobs/runner.ts";
import type {
  AuthorizationClassification,
  ReadAuthorization,
  SriClassifiers,
  ValidityClassification,
} from "../../sri-engine/application/classification.ts";
import type { SriInquiryPort } from "../../sri-engine/application/transport.ts";
import { canTransition, type DocumentState, type TransitionActor } from "../domain/document.ts";
import type { DocumentRepository, StoredDocument } from "./ports.ts";
import { nextPoll } from "./authorize-handler.ts";
import { authorizeJob, transmitJob } from "./transmission-jobs.ts";
import type { StoredSriResult } from "./transmission-ports.ts";
import type { TransmissionSettings } from "./transmission-settings.ts";
import {
  executeSriStep,
  type StepDecision,
  type StepDependencies,
  type StepTransition,
} from "./transmission-step.ts";

export type ReconcileHandlerDependencies = StepDependencies &
  Readonly<{
    documents: Pick<DocumentRepository, "find">;
    inquiry: SriInquiryPort;
    classifiers: SriClassifiers;
    settings: TransmissionSettings;
    random?: () => number;
  }>;

/** Estados que una reconciliación puede mover (design D15). */
const RECONCILABLE = new Set<DocumentState>([
  "SIGNED",
  "SEND_UNKNOWN",
  "RECEIVED",
  "MANUAL_REVIEW",
]);
const RECEPTION_EVIDENCE = new Set(["RECEIVED", "KEY_IN_PROCESS", "KEY_REGISTERED"]);

/** Evidencia guardada de los intentos: se calcula de los resultados, no de una bandera (D15). */
export function reconciliationEvidence(results: readonly StoredSriResult[]) {
  return {
    reception: results.some(
      (result) => result.operation === "RECEPTION" && RECEPTION_EVIDENCE.has(result.outcome),
    ),
    sequential45: results.some((result) => result.outcome === "SEQUENTIAL_REGISTERED"),
  };
}

/**
 * Camino de transiciones permitidas hasta `target` (design D3). `SIGNED` no salta a un estado
 * concluyente: pasa por `RECEIVED`, o por `SEND_UNKNOWN` hacia la revisión manual.
 */
export function pathTo(from: DocumentState, target: DocumentState): DocumentState[] {
  if (from === target) return [];
  if (canTransition(from, target)) return [target];
  if (from === "SIGNED" && target === "MANUAL_REVIEW") return ["SEND_UNKNOWN", "MANUAL_REVIEW"];
  if (from === "SIGNED" && (target === "AUTHORIZED" || target === "NOT_AUTHORIZED")) {
    return ["RECEIVED", target];
  }
  throw new Error(`sin camino de ${from} a ${target}`);
}

type Context = Readonly<{
  job: Job;
  document: StoredDocument;
  settings: TransmissionSettings;
  evidence: ReturnType<typeof reconciliationEvidence>;
  now: Date;
  random?: (() => number) | undefined;
}>;

const actorOf = (job: Job): TransitionActor =>
  job.origin === "MANUAL" && job.requestedBy
    ? { type: "USER", userId: job.requestedBy }
    : { type: "SYSTEM" };

function moveTo(
  context: Context,
  target: DocumentState,
  authorization?: ReadAuthorization,
): StepTransition[] {
  return pathTo(context.document.state, target).map((to) => ({
    to,
    cause: "RECONCILIATION",
    actor: actorOf(context.job),
    ...(to === "AUTHORIZED" && authorization ? { authorization } : {}),
  }));
}

/**
 * Acción y campo del comprobante en la auditoría de la finalización, por tipo (add-credit-notes,
 * design D2; add-debit-notes, design D17): un dato por tipo emitido, no un conmutador.
 */
const COMPLETED_AUDIT: Readonly<Record<string, { action: AuditAction; idField: string }>> = {
  "01": { action: "invoice.reconciliation_completed", idField: "invoiceId" },
  "04": { action: "credit_note.reconciliation_completed", idField: "creditNoteId" },
  // add-debit-notes, design D2 y D17.
  "05": { action: "debit_note.reconciliation_completed", idField: "debitNoteId" },
};

/** Estado final de una decisión, para la auditoría de la reconciliación manual. */
const finalState = (context: Context, transitions: readonly StepTransition[]) =>
  transitions.at(-1)?.to ?? context.document.state;

/** Cierra la decisión: con la auditoría de la finalización si la pidió el administrador (D19). */
function finish(
  context: Context,
  decision: Omit<StepDecision, "audit">,
  result: string,
): StepDecision {
  const { job, document } = context;
  const concludes = decision.job.action === "COMPLETE" || decision.job.action === "STOP";
  if (job.origin !== "MANUAL" || !job.requestedBy || !concludes) return decision;
  const audited = COMPLETED_AUDIT[document.documentType];
  if (!audited)
    throw new Error(`Sin auditoría de reconciliación para el tipo ${document.documentType}.`);
  const audit: AuditEventInput = {
    companyId: document.companyId,
    actor: { type: "USER", userId: job.requestedBy },
    action: audited.action,
    changes: {
      [audited.idField]: document.id,
      documentNumber: document.documentNumber,
      result,
      state: finalState(context, decision.transitions),
    },
    correlationId:
      typeof job.payload.correlationId === "string" ? job.payload.correlationId : `job-${job.id}`,
  };
  return { ...decision, audit };
}

const unavailable = (reason: string): JobError => ({
  code: "SRI_UNAVAILABLE",
  errorClass: "RETRYABLE",
  detail: { reason },
});

/** Otra consulta dentro de la ventana; al agotarla, `onExhausted`. */
function pollAgain(
  context: Context,
  onExhausted: () => StepDecision,
  error?: JobError,
): StepDecision {
  const at = nextPoll(context.job, context.now, context.settings.poll.backoff, context.random);
  if (at === null) return onExhausted();
  return {
    transitions: [],
    next: null,
    job: { action: "RESCHEDULE", at, consumeAttempt: true, ...(error ? { error } : {}) },
  };
}

function toManualReview(context: Context, result: string): StepDecision {
  const transitions = moveTo(context, "MANUAL_REVIEW");
  return finish(context, { transitions, next: null, job: { action: "COMPLETE" } }, result);
}

/** `RECEIVED` y la consulta de autorización, que obtiene el registro concluyente. */
function toReceived(context: Context, result: string): StepDecision {
  const { document, settings, now } = context;
  return finish(
    context,
    {
      transitions: moveTo(context, "RECEIVED"),
      next: authorizeJob(document, {
        runAt: new Date(now.getTime() + settings.poll.firstDelayMs),
        deadlineAt: new Date(now.getTime() + settings.poll.windowMs),
      }),
      job: { action: "COMPLETE" },
    },
    result,
  );
}

/** Fallo técnico de una consulta: reintenta en la ventana; al agotarla, el job se detiene. */
function technical(context: Context, reason: string): StepDecision {
  return pollAgain(
    context,
    () =>
      finish(
        context,
        { transitions: [], next: null, job: { action: "STOP", error: unavailable(reason) } },
        "STOPPED",
      ),
    unavailable(reason),
  );
}

/**
 * Decisión tras la autorización por clave (design D12, columna "Desde SEND_UNKNOWN", y D15).
 * `VALIDITY` pide consultar la validez antes de concluir que el SRI no conoce la clave.
 */
export function decideAfterAuthorization(
  classification: AuthorizationClassification | null,
  context: Context,
): StepDecision | "VALIDITY" {
  if (classification === null) return technical(context, "UNPARSEABLE");
  switch (classification.outcome) {
    case "AUTHORIZED":
      return finish(
        context,
        {
          transitions: moveTo(context, "AUTHORIZED", classification.authorization!),
          next: null,
          job: { action: "COMPLETE" },
        },
        "AUTHORIZED",
      );
    case "NOT_AUTHORIZED":
      return finish(
        context,
        { transitions: moveTo(context, "NOT_AUTHORIZED"), next: null, job: { action: "COMPLETE" } },
        "NOT_AUTHORIZED",
      );
    case "INCONSISTENT":
      return toManualReview(context, "INCONSISTENT");
    case "NO_CONCLUSION":
      if (classification.cause === "TECHNICAL") {
        return technical(context, String(classification.parsed.reason ?? "TECHNICAL"));
      }
      // Con una autorización sin conclusión, el SRI conoce la clave y la está procesando.
      if (Number(classification.parsed.autorizaciones ?? 0) > 0)
        return toReceived(context, "IN_PROCESS");
      return pollAgain(context, () => toManualReview(context, "WINDOW_EXHAUSTED"));
    case "KEY_UNKNOWN":
      return "VALIDITY";
  }
}

/** Decisión ante una clave que la autorización no conoce, con la guarda de validez (D15). */
export function decideAfterValidity(
  validity: ValidityClassification | null,
  context: Context,
): StepDecision {
  // Una respuesta por otra clave es inconsistente con el comprobante (design D4).
  if (validity?.outcome === "INCONSISTENT") return toManualReview(context, "INCONSISTENT");
  if (validity?.outcome === "KEY_KNOWN") {
    // Un estado informado impide reenviar. Una anulación es un estado que este cambio no modela.
    if (validity.state === "PENDIENTE DE ANULAR" || validity.state === "ANULADO") {
      return toManualReview(context, `VALIDITY_${validity.state.replace(/ /g, "_")}`);
    }
    return toReceived(context, "VALIDITY_KEY_KNOWN");
  }
  // Ninguna evidencia muestra que el SRI conozca la clave.
  const { document } = context;
  if (document.state === "MANUAL_REVIEW") {
    return finish(
      context,
      { transitions: [], next: null, job: { action: "COMPLETE" } },
      "KEY_UNKNOWN",
    );
  }
  if (context.evidence.reception) {
    return pollAgain(context, () => toManualReview(context, "WINDOW_EXHAUSTED"));
  }
  if (context.evidence.sequential45)
    return toManualReview(context, "SEQUENTIAL_REGISTERED_KEY_UNKNOWN");
  // Solo hubo incertidumbre de transporte: se reenvían los mismos bytes (design D9).
  return finish(
    context,
    {
      transitions: [],
      next: transmitJob(document, context.settings, context.now),
      job: { action: "COMPLETE" },
    },
    "RESEND",
  );
}

export function createReconcileHandler(deps: ReconcileHandlerDependencies) {
  /** `reconcileDocument(companyId, documentId, origin)`: el origen viene del job. */
  async function reconcileDocument(job: Job, context: { signal: AbortSignal; now: () => Date }) {
    const document = job.documentId
      ? await deps.documents.find(job.companyId, job.documentId)
      : null;
    if (!document) {
      await deps.jobs.stop(
        deps.db,
        job,
        { code: "DOCUMENT_NOT_FOUND", errorClass: "DETERMINISTIC" },
        context.now(),
      );
      return;
    }
    // Ya concluyó, o es una revisión manual y el job no es del administrador: nada que hacer.
    if (
      !RECONCILABLE.has(document.state) ||
      (document.state === "MANUAL_REVIEW" && job.origin !== "MANUAL")
    ) {
      await deps.jobs.complete(deps.db, job, context.now());
      return;
    }
    const contextOf = async (target: StoredDocument, now: Date): Promise<Context> => ({
      job,
      document: target,
      settings: deps.settings,
      evidence: reconciliationEvidence(await deps.evidence.results(target.companyId, target.id)),
      now,
      random: deps.random,
    });
    const runValidity = () =>
      executeSriStep(
        deps,
        {
          operation: "VALIDITY",
          call: (target) => deps.inquiry.queryValidity(target.environment, target.accessKey),
          classify: (outcome, target) => {
            const value = deps.classifiers.validity(outcome, target.accessKey);
            return {
              value,
              outcome: value.outcome,
              messages: value.messages,
              parsed: { ...value.parsed, ...(value.state ? { state: value.state } : {}) },
              classifierVersion: deps.classifiers.versions.validity,
            };
          },
          decide: async ({ classification, document: target, now }) =>
            decideAfterValidity(classification, await contextOf(target, now)),
        },
        { job, document, signal: context.signal, now: context.now },
      );

    // Una caída entre la TX A y la TX B de la consulta de validez se retoma en ella.
    if (await deps.evidence.unclassified(job.companyId, job.id, "VALIDITY")) {
      await runValidity();
      return;
    }
    let keyUnknown = false;
    const result = await executeSriStep(
      deps,
      {
        operation: "AUTHORIZATION",
        call: (target) => deps.inquiry.queryAuthorization(target.environment, target.accessKey),
        classify: (outcome, target) => {
          const value = deps.classifiers.authorization(outcome, {
            accessKey: target.accessKey,
            environment: target.environment,
          });
          return {
            value,
            outcome: value.outcome,
            messages: value.messages,
            parsed: { ...value.parsed, ...(value.cause ? { cause: value.cause } : {}) },
            classifierVersion: deps.classifiers.versions.authorization,
          };
        },
        decide: async ({ classification, document: target, now }) => {
          const decision = decideAfterAuthorization(classification, await contextOf(target, now));
          if (decision !== "VALIDITY") return decision;
          keyUnknown = true;
          return { transitions: [], next: null, job: { action: "CONTINUE" } };
        },
      },
      { job, document, signal: context.signal, now: context.now },
    );
    if (result === "DECIDED" && keyUnknown) await runValidity();
  }

  const handler: JobHandler = { run: reconcileDocument, backoff: deps.settings.poll.backoff };
  return { handler, reconcileDocument };
}

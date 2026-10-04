// Procedimiento común de los handlers de la transmisión (add-sri-transmission, design D8):
//
//   transporte ─▶ TX A: intento + respuesta original ─▶ COMMIT
//              ─▶ clasificar (puro)
//              ─▶ TX B: resultado + transición guardada + autorización y artefacto
//                       + job actual DONE + siguiente job + auditoría ─▶ COMMIT
//
// Ningún resultado existe sin su intento confirmado antes, y ninguna transición sin su resultado.
// Al retomar un job se clasifica primero el intento que quedó sin resultado, sin llamar al SRI. Si
// el clasificador falla, el resultado es `UNPARSEABLE`, sin conclusión, y la evidencia se conserva.
// Si el arriendo se perdió, la TX B se revierte: el intento queda y se clasifica al retomarse.
import type { AuditEventInput } from "../../audit/domain/audit-event.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type {
  BackoffPolicy,
  Job,
  JobError,
  JobStore,
  NewJob,
} from "../../../platform/jobs/jobs.ts";
import type { ReadAuthorization } from "../../sri-engine/application/classification.ts";
import {
  isBreakerOpen,
  type BreakerOpen,
  type SriExchange,
  type TransportOutcome,
} from "../../sri-engine/application/transport.ts";
import type { DocumentState, TransitionActor, TransitionCause } from "../domain/document.ts";
import type { SriMessage, SriOperation, SriOutcome } from "../domain/transmission.ts";
import type { ArtifactStore, DocumentRepository, StoredDocument } from "./ports.ts";
import type {
  NewSriAttemptResult,
  SriEvidenceRepository,
  StoredSriAttempt,
} from "./transmission-ports.ts";

/** Clasificación de un intento, lista para guardarse como resultado. */
export type Classified<C> = Readonly<{
  value: C;
  outcome: SriOutcome;
  messages: readonly SriMessage[];
  parsed: NewSriAttemptResult["parsed"];
  classifierVersion: string;
}>;

export type JobFollowUp =
  /** Solo guarda el resultado: el mismo arriendo sigue con otra consulta (design D15). */
  | Readonly<{ action: "CONTINUE" }>
  | Readonly<{ action: "COMPLETE" }>
  | Readonly<{ action: "RESCHEDULE"; at: Date; consumeAttempt: boolean; error?: JobError }>
  | Readonly<{ action: "FAIL"; error: JobError; backoff: BackoffPolicy }>
  | Readonly<{ action: "STOP"; error: JobError }>;

export type StepTransition = Readonly<{
  to: DocumentState;
  cause: TransitionCause;
  actor?: TransitionActor;
  authorization?: ReadAuthorization;
}>;

/**
 * La decisión de un paso: se confirma entera en la TX B, o nada. Las transiciones se aplican en
 * orden, cada una guardada por el estado anterior; nunca saltan la tabla de design D3.
 */
export type StepDecision = Readonly<{
  transitions: readonly StepTransition[];
  /** Job de la fase siguiente: nace en la misma transacción en que termina el actual. */
  next: NewJob | null;
  job: JobFollowUp;
  audit?: AuditEventInput;
}>;

export type StepInput<C> = Readonly<{
  job: Job;
  document: StoredDocument;
  attempt: StoredSriAttempt;
  /** Null si el clasificador falló: `UNPARSEABLE`, sin conclusión. */
  classification: C | null;
  now: Date;
}>;

export type SriStep<C> = Readonly<{
  operation: SriOperation;
  /** La llamada al SRI; solo ocurre si no hay un intento del job pendiente de clasificar. */
  call: (document: StoredDocument) => Promise<SriExchange | BreakerOpen>;
  /** En los envíos, el `SIGNED_XML` enviado, para la evidencia. */
  sentArtifact?: Readonly<{ sha256: string; sizeBytes: number }>;
  classify: (outcome: TransportOutcome, document: StoredDocument) => Classified<C>;
  decide: (input: StepInput<C>) => Promise<StepDecision> | StepDecision;
}>;

/** Transacción de la decisión (TX B), con los repositorios ligados a ella. */
export type TransmissionScope = Readonly<{
  db: DbClient;
  evidence: SriEvidenceRepository;
  documents: DocumentRepository;
  artifacts: ArtifactStore;
  audit: AuditLog;
}>;

export interface TransmissionUnitOfWork {
  run<T>(work: (scope: TransmissionScope) => Promise<T>): Promise<T>;
}

/** Observador de las métricas de la transmisión (design D21); sin datos de la empresa. */
export type TransmissionObserver = Readonly<{
  attempt(
    operation: SriOperation,
    outcome: SriOutcome,
    seconds: number,
    messages: readonly SriMessage[],
  ): void;
  /** De `SIGNED` a `AUTHORIZED`. */
  authorized(seconds: number): void;
}>;

export type StepDependencies = Readonly<{
  /** Cliente raíz: reprograma el job cuando no hubo llamada. */
  db: DbClient;
  evidence: SriEvidenceRepository;
  uow: TransmissionUnitOfWork;
  jobs: JobStore;
  logger: Readonly<{
    info(details: object, message: string): void;
    warn(details: object, message: string): void;
  }>;
  observer?: TransmissionObserver;
  /** Fuente del jitter del backoff, también al fallar el job; inyectable en las pruebas. */
  random?: (() => number) | undefined;
}>;

export const UNPARSEABLE_VERSION = "unparseable/1";

/** El estado cambió por otro camino entre la lectura y la TX B: la decisión no vale. */
export class DocumentStateChangedError extends Error {
  constructor() {
    super("el estado del comprobante cambió antes de confirmar la decisión");
    this.name = "DocumentStateChangedError";
  }
}

export type StepResult = "DECIDED" | "BREAKER_OPEN" | "SHUTTING_DOWN";

/** Aplica la decisión en la TX B. El job actual termina antes de que nazca el siguiente. */
export async function applyDecision(
  deps: Pick<StepDependencies, "uow" | "jobs" | "random">,
  input: Readonly<{
    job: Job;
    document: StoredDocument;
    attemptId: string | null;
    result: NewSriAttemptResult | null;
    decision: StepDecision;
    now: Date;
  }>,
): Promise<void> {
  const { job, document, decision, now } = input;
  await deps.uow.run(async (scope) => {
    if (input.result) await scope.evidence.recordResult(input.result);
    let state = document.state;
    for (const { to, cause, actor, authorization } of decision.transitions) {
      const changed = await scope.documents.advance(
        document.companyId,
        document.id,
        state,
        to,
        authorization
          ? {
              number: authorization.number,
              date: authorization.date,
              environment: authorization.environment,
            }
          : undefined,
      );
      if (!changed) throw new DocumentStateChangedError();
      await scope.documents.recordTransition({
        companyId: document.companyId,
        documentId: document.id,
        from: state,
        to,
        cause,
        actor: actor ?? { type: "SYSTEM" },
        metadata: { jobId: job.id, ...(input.attemptId ? { sriAttemptId: input.attemptId } : {}) },
      });
      if (authorization?.authorizedXml) {
        await scope.artifacts.save({
          companyId: document.companyId,
          documentId: document.id,
          kind: "AUTHORIZED_XML",
          mediaType: "application/xml",
          content: authorization.authorizedXml,
          metadata: {
            sriAttemptId: input.attemptId,
            authorizationNumber: authorization.number,
            authorizationDate: authorization.dateText,
          },
        });
      }
      state = to;
    }
    const followUp = decision.job;
    if (followUp.action === "CONTINUE") {
      // El job sigue arrendado: la decisión llega con la consulta siguiente.
    } else if (followUp.action === "COMPLETE") await deps.jobs.complete(scope.db, job, now);
    else if (followUp.action === "RESCHEDULE") {
      await deps.jobs.reschedule(scope.db, job, {
        at: followUp.at,
        now,
        consumeAttempt: followUp.consumeAttempt,
        ...(followUp.error ? { error: followUp.error } : {}),
      });
    } else if (followUp.action === "FAIL") {
      await deps.jobs.fail(scope.db, job, followUp.error, {
        backoff: followUp.backoff,
        now,
        ...(deps.random ? { random: deps.random } : {}),
      });
    } else await deps.jobs.stop(scope.db, job, followUp.error, now);
    if (decision.next && !(await deps.jobs.enqueueIn(scope.db, decision.next))) {
      throw new Error(`no se pudo encolar ${decision.next.type}: hay otra interacción activa`);
    }
    if (decision.audit) await scope.audit.append(decision.audit);
  });
}

/**
 * Ejecuta un paso de la transmisión sobre un job arrendado (design D8). Devuelve si decidió, si el
 * circuit breaker impidió la llamada (el job se reprograma sin consumir el intento) o si el apagado
 * llegó antes de llamar.
 */
export async function executeSriStep<C>(
  deps: StepDependencies,
  step: SriStep<C>,
  input: Readonly<{ job: Job; document: StoredDocument; signal: AbortSignal; now: () => Date }>,
): Promise<StepResult> {
  const { job, document } = input;
  let attempt = await deps.evidence.unclassified(job.companyId, job.id, step.operation);
  if (attempt) {
    deps.logger.warn(
      { jobId: job.id, documentId: document.id, attemptId: attempt.id },
      "intento sin clasificar: se clasifica desde la respuesta guardada, sin llamar al SRI",
    );
  } else {
    // Sin llamada no se gasta el intento: el apagado y el breaker abierto reprograman el job.
    if (input.signal.aborted) {
      const now = input.now();
      await deps.jobs.reschedule(deps.db, job, { at: now, now, consumeAttempt: false });
      return "SHUTTING_DOWN";
    }
    const exchange = await step.call(document);
    if (isBreakerOpen(exchange)) {
      await deps.jobs.reschedule(deps.db, job, {
        at: exchange.retryAt,
        now: input.now(),
        consumeAttempt: false,
      });
      return "BREAKER_OPEN";
    }
    attempt = await deps.evidence.record({
      companyId: document.companyId,
      documentId: document.id,
      jobId: job.id,
      operation: step.operation,
      environment: exchange.environment,
      endpoint: exchange.endpoint,
      origin: job.origin,
      initiatedBy: job.origin === "MANUAL" ? job.requestedBy : null,
      outcome: exchange.outcome,
      envelope: exchange.envelope,
      ...(step.sentArtifact ? { sentArtifact: step.sentArtifact } : {}),
    });
  }

  let classified: Classified<C> | null = null;
  try {
    classified = step.classify(attempt.outcome, document);
  } catch (error) {
    deps.logger.warn(
      { jobId: job.id, documentId: document.id, attemptId: attempt.id, err: error },
      "el clasificador falló: el intento queda sin conclusión",
    );
  }
  const now = input.now();
  const decision = await step.decide({
    job,
    document,
    attempt,
    classification: classified?.value ?? null,
    now,
  });
  await applyDecision(deps, {
    job,
    document,
    attemptId: attempt.id,
    result: {
      companyId: document.companyId,
      attemptId: attempt.id,
      outcome: classified?.outcome ?? "UNPARSEABLE",
      messages: classified?.messages ?? [],
      parsed: classified?.parsed ?? null,
      classifierVersion: classified?.classifierVersion ?? UNPARSEABLE_VERSION,
    },
    decision,
    now,
  });
  const outcome = classified?.outcome ?? "UNPARSEABLE";
  const seconds =
    (attempt.outcome.completedAt.getTime() - attempt.outcome.startedAt.getTime()) / 1_000;
  deps.observer?.attempt(step.operation, outcome, seconds, classified?.messages ?? []);
  if (
    decision.transitions.some((transition) => transition.to === "AUTHORIZED") &&
    document.signedAt
  ) {
    deps.observer?.authorized((now.getTime() - document.signedAt.getTime()) / 1_000);
  }
  deps.logger.info(
    {
      jobId: job.id,
      documentId: document.id,
      accessKey: document.accessKey,
      operation: step.operation,
      attemptId: attempt.id,
      transport: attempt.outcome.kind,
      outcome,
      to: decision.transitions.at(-1)?.to ?? null,
      durationMs: Math.round(seconds * 1_000),
    },
    "intento con el SRI clasificado",
  );
  return "DECIDED";
}

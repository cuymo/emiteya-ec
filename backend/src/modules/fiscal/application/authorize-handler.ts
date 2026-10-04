// Handler `sri.authorize` (add-sri-transmission, design D4, D12 y D16): consulta la autorización
// por la misma clave en el servicio del ambiente del comprobante, con espera creciente dentro de la
// ventana de conclusión. Un `AUTORIZADO` válido guarda la autorización y el XML autorizado exacto;
// un no autorizado es terminal; una inconsistencia va a revisión manual. Lo que no concluye vuelve
// a consultar: si el SRI siguió sin conclusión al agotar la ventana, revisión manual; si fallaron
// los intentos técnicos, el job se detiene sin cambiar el estado.
import type { BackoffPolicy, Job, JobError } from "../../../platform/jobs/jobs.ts";
import { backoffDelayMs } from "../../../platform/jobs/jobs.ts";
import type { JobHandler } from "../../../platform/jobs/runner.ts";
import type {
  AuthorizationClassification,
  SriClassifiers,
} from "../../sri-engine/application/classification.ts";
import type { SriGateway } from "../../sri-engine/application/transport.ts";
import type { DocumentRepository, StoredDocument } from "./ports.ts";
import type { TransmissionSettings } from "./transmission-settings.ts";
import { executeSriStep, type StepDecision, type StepDependencies } from "./transmission-step.ts";

export type AuthorizeHandlerDependencies = StepDependencies &
  Readonly<{
    documents: Pick<DocumentRepository, "find">;
    gateway: Pick<SriGateway, "queryAuthorization">;
    classifiers: SriClassifiers;
    settings: TransmissionSettings;
    random?: () => number;
  }>;

const SRI_UNAVAILABLE = (detail: JobError["detail"] = {}): JobError => ({
  code: "SRI_UNAVAILABLE",
  errorClass: "RETRYABLE",
  detail,
});

/**
 * Próxima consulta sin conclusión: con backoff, sin pasar del fin de la ventana. Null si la ventana
 * ya se agotó.
 */
export function nextPoll(
  job: Job,
  now: Date,
  backoff: BackoffPolicy,
  random: () => number = Math.random,
): Date | null {
  if (job.deadlineAt && now >= job.deadlineAt) return null;
  const at = new Date(now.getTime() + backoffDelayMs(job.attemptCount, backoff, random));
  return job.deadlineAt && at > job.deadlineAt ? job.deadlineAt : at;
}

/** Decisión de la autorización desde `RECEIVED` (design D12, columna "Desde RECEIVED"). */
export function decideAuthorization(
  classification: AuthorizationClassification | null,
  input: Readonly<{ job: Job; settings: TransmissionSettings; now: Date; random?: () => number }>,
): StepDecision {
  const { job, settings, now } = input;
  const technical = (reason: string): StepDecision => ({
    transitions: [],
    next: null,
    job: { action: "FAIL", error: SRI_UNAVAILABLE({ reason }), backoff: settings.poll.backoff },
  });
  if (classification === null) return technical("UNPARSEABLE");
  switch (classification.outcome) {
    case "AUTHORIZED":
      return {
        transitions: [
          {
            to: "AUTHORIZED",
            cause: "AUTHORIZATION",
            authorization: classification.authorization!,
          },
        ],
        next: null,
        job: { action: "COMPLETE" },
      };
    case "NOT_AUTHORIZED":
      return {
        transitions: [{ to: "NOT_AUTHORIZED", cause: "AUTHORIZATION" }],
        next: null,
        job: { action: "COMPLETE" },
      };
    case "INCONSISTENT":
      return {
        transitions: [{ to: "MANUAL_REVIEW", cause: "AUTHORIZATION" }],
        next: null,
        job: { action: "COMPLETE" },
      };
    case "KEY_UNKNOWN":
    case "NO_CONCLUSION": {
      if (classification.cause === "TECHNICAL") {
        return technical(String(classification.parsed.reason ?? "TECHNICAL"));
      }
      // El SRI respondió sin concluir (o todavía no indexa la clave): otra consulta en la ventana.
      const at = nextPoll(job, now, settings.poll.backoff, input.random);
      if (at === null) {
        return {
          transitions: [{ to: "MANUAL_REVIEW", cause: "AUTHORIZATION" }],
          next: null,
          job: { action: "COMPLETE" },
        };
      }
      return {
        transitions: [],
        next: null,
        job: { action: "RESCHEDULE", at, consumeAttempt: true },
      };
    }
  }
}

export function createAuthorizeHandler(deps: AuthorizeHandlerDependencies): JobHandler {
  async function run(job: Job, context: { signal: AbortSignal; now: () => Date }): Promise<void> {
    const document: StoredDocument | null = job.documentId
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
    // Solo se consulta un comprobante recibido: los demás ya concluyeron o esperan a una persona
    // (design D4); ningún proceso automático cambia una revisión manual.
    if (document.state !== "RECEIVED") {
      await deps.jobs.complete(deps.db, job, context.now());
      return;
    }
    await executeSriStep(
      deps,
      {
        operation: "AUTHORIZATION",
        call: (target) => deps.gateway.queryAuthorization(target.environment, target.accessKey),
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
        decide: ({ classification, now }) =>
          decideAuthorization(classification, {
            job,
            settings: deps.settings,
            now,
            ...(deps.random ? { random: deps.random } : {}),
          }),
      },
      { job, document, signal: context.signal, now: context.now },
    );
  }

  return { run, backoff: deps.settings.poll.backoff };
}

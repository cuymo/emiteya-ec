// Handler `sri.transmit` (add-sri-transmission, design D9, D11, D13, D14 y D17): envía los bytes
// exactos del `SIGNED_XML` guardado, después de comprobar su integridad y el límite de tamaño, y
// decide según la respuesta de recepción. Los reenvíos usan el mismo procedimiento. Nunca
// reconstruye el XML ni reserva otro número.
import { createHash } from "node:crypto";
import type { JobHandler } from "../../../platform/jobs/runner.ts";
import type { Job, JobError } from "../../../platform/jobs/jobs.ts";
import type { SriGateway } from "../../sri-engine/application/transport.ts";
import type { ArtifactStore, DocumentRepository, StoredArtifact, StoredDocument } from "./ports.ts";
import { authorizeJob, reconcileJob } from "./transmission-jobs.ts";
import type { TransmissionSettings } from "./transmission-settings.ts";
import {
  applyDecision,
  executeSriStep,
  type StepDecision,
  type StepDependencies,
} from "./transmission-step.ts";
import type {
  ReceptionClassification,
  SriClassifiers,
} from "../../sri-engine/application/classification.ts";

export type SizePolicyReader = (date: string) => Promise<{ maxSignedDocumentBytes: number } | null>;

export type TransmitHandlerDependencies = StepDependencies &
  Readonly<{
    documents: Pick<DocumentRepository, "find">;
    artifacts: Pick<ArtifactStore, "read">;
    sizePolicy: SizePolicyReader;
    gateway: Pick<SriGateway, "prepareReception" | "submit">;
    classifiers: SriClassifiers;
    settings: TransmissionSettings;
    /** Fecha del envío en Ecuador, para resolver la política de tamaño (design D17). */
    today: (now: Date) => string;
    alert: (details: object, message: string) => void;
  }>;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Estados desde los que se envía: el primer envío y el reenvío desde `SEND_UNKNOWN` (design D15). */
const TRANSMITTABLE = new Set(["SIGNED", "SEND_UNKNOWN"]);

/**
 * Comprobaciones de design D9 sobre el artefacto leído; devuelve la que falla, o null. El artefacto
 * se lee por empresa, comprobante y tipo, así que pertenece a ambos.
 */
export function integrityProblem(
  document: StoredDocument,
  artifact: StoredArtifact | null,
): string | null {
  if (!artifact) return "MISSING_ARTIFACT";
  if (artifact.content.length !== artifact.sizeBytes) return "SIZE";
  if (sha256(artifact.content) !== artifact.sha256) return "SHA256";
  const snapshotKey = (document.snapshot as { key?: { accessKey?: unknown } } | null)?.key
    ?.accessKey;
  if (snapshotKey !== document.accessKey) return "SNAPSHOT_ACCESS_KEY";
  const occurrences =
    artifact.content.toString("utf8").split(`<claveAcceso>${document.accessKey}</claveAcceso>`)
      .length - 1;
  if (occurrences !== 1) return "XML_ACCESS_KEY";
  if (
    artifact.metadata.documentType !== document.documentType ||
    artifact.metadata.schemaVersion !== document.schemaVersion
  ) {
    return "METADATA";
  }
  return null;
}

const stopError = (
  code: string,
  errorClass: JobError["errorClass"],
  detail: JobError["detail"] = {},
): JobError => ({
  code,
  errorClass,
  detail,
});

/**
 * Decisión de la recepción (design D11 y D13). Desde `SIGNED` o `SEND_UNKNOWN` (un reenvío):
 * `RECIBIDA` pasa a `RECEIVED` con la consulta de autorización; un `DEVUELTA` concluyente, a
 * `RETURNED`; los errores 70, 43 y 45, una respuesta incierta o un clasificador que falla, a
 * `SEND_UNKNOWN` con la reconciliación; una clave distinta, a `MANUAL_REVIEW` pasando por
 * `SEND_UNKNOWN`, porque la tabla no tiene `SIGNED` → `MANUAL_REVIEW`. `NOT_SENT` no cambia nada.
 */
export function decideReception(
  classification: ReceptionClassification | null,
  input: Readonly<{ document: StoredDocument; settings: TransmissionSettings; now: Date }>,
): StepDecision {
  const { document, settings, now } = input;
  const toUnknown =
    document.state === "SIGNED"
      ? [{ to: "SEND_UNKNOWN" as const, cause: "TRANSMISSION" as const }]
      : [];
  const reconcileAt = (delayMs: number): StepDecision => ({
    transitions: toUnknown,
    next: reconcileJob(document, {
      origin: "AUTOMATIC",
      runAt: new Date(now.getTime() + delayMs),
      windowMs: settings.poll.windowMs,
      windowStart: now,
    }),
    job: { action: "COMPLETE" },
  });
  if (classification === null) return reconcileAt(0);
  switch (classification.outcome) {
    case "NOT_SENT":
      return {
        transitions: [],
        next: null,
        job: {
          action: "FAIL",
          error: stopError("SRI_UNAVAILABLE", "RETRYABLE", {
            transport: String(classification.parsed.errorCode ?? "NOT_SENT"),
          }),
          backoff: settings.transmit.backoff,
        },
      };
    case "RECEIVED":
      return {
        transitions: [{ to: "RECEIVED", cause: "TRANSMISSION" }],
        next: authorizeJob(document, {
          runAt: new Date(now.getTime() + settings.poll.firstDelayMs),
          deadlineAt: new Date(now.getTime() + settings.poll.windowMs),
        }),
        job: { action: "COMPLETE" },
      };
    case "RETURNED":
      return {
        transitions: [{ to: "RETURNED", cause: "TRANSMISSION" }],
        next: null,
        job: { action: "COMPLETE" },
      };
    case "KEY_IN_PROCESS":
      return reconcileAt(settings.poll.error70DelayMs);
    case "KEY_REGISTERED":
    case "SEQUENTIAL_REGISTERED":
    case "UNKNOWN":
      return reconcileAt(0);
    case "INCONSISTENT":
      return {
        transitions: [...toUnknown, { to: "MANUAL_REVIEW", cause: "TRANSMISSION" }],
        next: null,
        job: { action: "COMPLETE" },
      };
  }
}

export function createTransmitHandler(deps: TransmitHandlerDependencies): JobHandler {
  async function run(job: Job, context: { signal: AbortSignal; now: () => Date }): Promise<void> {
    const document = job.documentId
      ? await deps.documents.find(job.companyId, job.documentId)
      : null;
    if (!document) {
      await deps.jobs.stop(
        deps.db,
        job,
        stopError("DOCUMENT_NOT_FOUND", "DETERMINISTIC"),
        context.now(),
      );
      return;
    }
    // El estado ya avanzó por otro camino: el envío no hace falta.
    if (!TRANSMITTABLE.has(document.state)) {
      await deps.jobs.complete(deps.db, job, context.now());
      return;
    }
    let callStarted = false;
    try {
      const pending = await deps.evidence.unclassified(job.companyId, job.id);
      let artifact: StoredArtifact | null = null;
      if (!pending) {
        // Un arriendo anterior de este job empezó a enviar y no dejó evidencia: el proceso cayó
        // durante la llamada (CTX §22.3). Pudo salir, así que se reconcilia antes de reenviar.
        const recorded = await deps.evidence.countForJob(job.companyId, job.id);
        if (job.attemptCount - 1 > recorded) {
          deps.alert(
            { jobId: job.id, documentId: document.id },
            "envío interrumpido sin evidencia: se reconcilia antes de reenviar",
          );
          await applyDecision(deps, {
            job,
            document,
            attemptId: null,
            result: null,
            decision: decideReception(
              { outcome: "UNKNOWN", messages: [], parsed: { reason: "INTERRUPTED_CALL" } },
              {
                document,
                settings: deps.settings,
                now: context.now(),
              },
            ),
            now: context.now(),
          });
          return;
        }
        artifact = await deps.artifacts.read(document.companyId, document.id, "SIGNED_XML");
        const problem = integrityProblem(document, artifact);
        if (problem) {
          deps.alert(
            { jobId: job.id, documentId: document.id, check: problem },
            "integridad del XML firmado fallida: no se envió",
          );
          await deps.jobs.stop(
            deps.db,
            job,
            stopError("INTEGRITY_FAILED", "INTEGRITY", { check: problem }),
            context.now(),
          );
          return;
        }
        const policy = await deps.sizePolicy(deps.today(context.now()));
        if (!policy) {
          deps.alert(
            { jobId: job.id, documentId: document.id },
            "sin política de tamaño vigente: no se envió",
          );
          await deps.jobs.stop(
            deps.db,
            job,
            stopError("SIZE_POLICY_MISSING", "DETERMINISTIC"),
            context.now(),
          );
          return;
        }
        if (artifact!.content.length > policy.maxSignedDocumentBytes) {
          deps.alert(
            { jobId: job.id, documentId: document.id },
            "el XML firmado supera el límite de tamaño: no se envió",
          );
          await deps.jobs.stop(
            deps.db,
            job,
            stopError("TOO_LARGE", "DETERMINISTIC", {
              sizeBytes: artifact!.content.length,
              maxBytes: policy.maxSignedDocumentBytes,
            }),
            context.now(),
          );
          return;
        }
      }
      const sent = artifact;
      // El cuerpo final se construye una sola vez: es el que se mide y el que recibe el transporte.
      const prepared = sent ? deps.gateway.prepareReception(sent.content) : null;
      await executeSriStep(
        deps,
        {
          operation: "RECEPTION",
          call: (target) => {
            callStarted = true;
            return deps.gateway.submit(target.environment, prepared!);
          },
          ...(sent
            ? { sentArtifact: { sha256: sha256(sent.content), sizeBytes: sent.content.length } }
            : {}),
          classify: (outcome, target) => {
            const value = deps.classifiers.reception(outcome, target.accessKey);
            return { value, ...value, classifierVersion: deps.classifiers.versions.reception };
          },
          decide: ({ classification, document: target, now }) =>
            decideReception(classification, { document: target, settings: deps.settings, now }),
        },
        { job, document, signal: context.signal, now: context.now },
      );
    } catch (error) {
      // Un fallo antes de llamar no gasta el intento: así un intento sin evidencia siempre
      // significa que la llamada empezó. Uno posterior pudo enviar y se propaga.
      if (callStarted) throw error;
      const now = context.now();
      await deps.jobs.reschedule(deps.db, job, {
        at: new Date(now.getTime() + deps.settings.transmit.backoff.baseMs),
        now,
        consumeAttempt: false,
        error: stopError("HANDLER_ERROR", "RETRYABLE"),
      });
      deps.alert({ jobId: job.id, err: error }, "fallo antes de enviar: el job se reprograma");
    }
  }

  return { run, backoff: deps.settings.transmit.backoff };
}

// Handler del job `document.render_ride` (add-document-archive, design D3 a D5): genera el RIDE de
// un comprobante autorizado una sola vez y lo guarda como artefacto inmutable `RIDE_PDF`.
//
//   comprobante AUTHORIZED ─▶ ¿ya tiene RIDE_PDF? ─sí─▶ job DONE, nada que generar
//        │ no
//        ▼
//   fuente: AUTHORIZED_XML, o SIGNED_XML transmitido (SIGNED_XML_FALLBACK), con hash y tamaño
//        + autorización inmutable + denominaciones del snapshot + logo de su versión con su hash
//        ▼
//   render en el pool del RIDE ─▶ TX: RIDE_PDF + job DONE (guardada por el arriendo)
//
// Un fallo nunca cambia el estado fiscal: el comprobante sigue `AUTHORIZED`. Los fallos operativos
// reprograman o reintentan con backoff; los deterministas detienen el job con su motivo. Nunca lee
// terceros, productos, configuración vigente ni catálogos.
import { createHash } from "node:crypto";
import type { DbClient } from "../../../../platform/db/database.ts";
import type { Job, JobError, JobStore } from "../../../../platform/jobs/jobs.ts";
import type { JobHandler } from "../../../../platform/jobs/runner.ts";
import {
  RideRenderUnavailableError,
  type RideLogo,
  type RideRenderer,
  type RideWithholdingLabels,
} from "../../../sri-engine/application/ride.ts";
import type {
  ArtifactStore,
  DocumentRepository,
  StoredArtifact,
  StoredDocument,
} from "../ports.ts";
import type { RideJobSettings } from "./ride-jobs.ts";
import type { RideLogoSource, RideObserver, RideUnitOfWork } from "./ride-ports.ts";

/** Procedencia del RIDE: nunca se presenta un XML firmado como autorizado (design D3). */
export type RideProvenance = "AUTHORIZED_XML" | "SIGNED_XML_FALLBACK";

/** Motivos de detención del job propios de `fiscal`, además de los rechazos del renderer. */
export const RIDE_STOP_CODES = [
  "RIDE_SOURCE_INVALID",
  "RIDE_DOCUMENT_NOT_FOUND",
  "RIDE_DOCUMENT_NOT_AUTHORIZED",
  "RIDE_SOURCE_INTEGRITY",
  "RIDE_LOGO_INTEGRITY",
] as const;

/** Espera tras un pool ocupado: no gasta el intento. */
export const RIDE_BUSY_DELAY_MS = 5_000;

export type RideHandlerDependencies = Readonly<{
  /** Cliente raíz: reprograma, falla o detiene el job fuera de la transacción del RIDE. */
  db: DbClient;
  documents: Pick<DocumentRepository, "find">;
  artifacts: Pick<ArtifactStore, "summary" | "read">;
  logos: RideLogoSource;
  renderer: RideRenderer;
  uow: RideUnitOfWork;
  jobs: Pick<JobStore, "complete" | "reschedule" | "fail" | "stop">;
  settings: RideJobSettings;
  observer?: RideObserver;
  logger: Readonly<{
    info(details: object, message: string): void;
    warn(details: object, message: string): void;
  }>;
  random?: () => number;
}>;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Detención determinista con un detalle seguro y acotado. */
class RideStop extends Error {
  readonly error: JobError;
  constructor(code: string, detail: readonly string[] = []) {
    super(code);
    this.name = "RideStop";
    this.error = {
      code,
      errorClass: code.endsWith("_INTEGRITY") ? "INTEGRITY" : "DETERMINISTIC",
      ...(detail.length > 0 ? { detail: { items: detail.join(",").slice(0, 500) } } : {}),
    };
  }
}

/**
 * Los bytes guardados coinciden con su hash y su tamaño. La lectura es por empresa, comprobante y
 * tipo, así que el artefacto pertenece al comprobante.
 */
function verified(artifact: StoredArtifact | null): StoredArtifact {
  if (
    !artifact ||
    artifact.content.length !== artifact.sizeBytes ||
    sha256(artifact.content) !== artifact.sha256
  ) {
    throw new RideStop("RIDE_SOURCE_INTEGRITY", artifact ? [artifact.kind] : ["SOURCE_MISSING"]);
  }
  return artifact;
}

type SnapshotFacts = Readonly<{
  configVersionId: string | null;
  paymentLabels: Readonly<Record<string, string>>;
  /** Solo el comprobante de retención (`07`): las denominaciones de sus documentos sustento. */
  withholdingLabels: RideWithholdingLabels | null;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Denominaciones de un comprobante de retención (add-withholding-receipts, design D19): el tipo de
 * cada documento sustento, el impuesto de cada retención y el de cada impuesto declarado, tal como
 * los congeló su snapshot. Se leen sin importar `withholding-receipts`.
 */
function withholdingLabelsOf(supports: readonly unknown[]): RideWithholdingLabels {
  const documentTypes: Record<string, string> = {};
  const taxes: Record<string, string> = {};
  const supportTaxes: Record<string, string> = {};
  const labelled = (
    target: Record<string, string>,
    item: unknown,
    codeKey: string,
    labelKey: string,
  ) => {
    if (isRecord(item) && typeof item[codeKey] === "string" && typeof item[labelKey] === "string") {
      target[item[codeKey]] = item[labelKey];
    }
  };
  for (const support of supports) {
    if (!isRecord(support)) continue;
    labelled(documentTypes, support.documentType, "code", "label");
    for (const item of Array.isArray(support.withholdings) ? support.withholdings : []) {
      labelled(taxes, item, "tax", "taxLabel");
    }
    for (const tax of Array.isArray(support.taxes) ? support.taxes : []) {
      labelled(supportTaxes, tax, "taxCode", "taxLabel");
    }
  }
  return { documentTypes, taxes, supportTaxes };
}

/**
 * Lo que el XML no trae, del snapshot inmutable del comprobante: la versión de la configuración
 * (para el logo), la denominación de cada forma de pago (design D3) y, en un comprobante de
 * retención, las de sus documentos sustento.
 */
function snapshotFacts(snapshot: unknown, documentType: string): SnapshotFacts {
  if (!isRecord(snapshot)) throw new RideStop("RIDE_SOURCE_INVALID", ["snapshot"]);
  const config = snapshot.taxpayerConfig;
  const configVersionId =
    isRecord(config) && typeof config.versionId === "string" ? config.versionId : null;
  const paymentLabels: Record<string, string> = {};
  const payments = Array.isArray(snapshot.payments) ? snapshot.payments : [];
  for (const payment of payments) {
    if (
      isRecord(payment) &&
      typeof payment.code === "string" &&
      typeof payment.officialLabel === "string"
    ) {
      paymentLabels[payment.code] = payment.officialLabel;
    }
  }
  const withholdingLabels =
    documentType === "07" && Array.isArray(snapshot.supports)
      ? withholdingLabelsOf(snapshot.supports)
      : null;
  return { configVersionId, paymentLabels, withholdingLabels };
}

const LOGO_TYPES = new Set(["image/png", "image/jpeg"]);

export function createRideHandler(deps: RideHandlerDependencies): JobHandler {
  const { jobs, logger } = deps;

  async function source(document: StoredDocument) {
    const authorized = await deps.artifacts.read(document.companyId, document.id, "AUTHORIZED_XML");
    if (authorized) {
      return { artifact: verified(authorized), provenance: "AUTHORIZED_XML" as const };
    }
    // El SRI autorizó de forma concluyente sin devolver el comprobante: lo transmitido es la fuente.
    const signed = await deps.artifacts.read(document.companyId, document.id, "SIGNED_XML");
    return { artifact: verified(signed), provenance: "SIGNED_XML_FALLBACK" as const };
  }

  async function logoOf(document: StoredDocument, configVersionId: string | null) {
    if (configVersionId === null) return null;
    const logo = await deps.logos(document.companyId, configVersionId);
    if (logo === null) return null;
    if (
      !LOGO_TYPES.has(logo.mimeType) ||
      logo.content.byteLength !== logo.sizeBytes ||
      sha256(logo.content) !== logo.sha256
    ) {
      throw new RideStop("RIDE_LOGO_INTEGRITY");
    }
    return {
      logo: { bytes: logo.content, mediaType: logo.mimeType as RideLogo["mediaType"] },
      sha256: logo.sha256,
    };
  }

  async function stop(job: Job, error: JobError, now: Date) {
    deps.observer?.failed(error.code);
    await jobs.stop(deps.db, job, error, now);
    logger.warn(
      { jobId: job.id, documentId: job.documentId, code: error.code },
      "generación del RIDE detenida",
    );
  }

  async function run(job: Job, context: { signal: AbortSignal; now: () => Date }) {
    const document = job.documentId
      ? await deps.documents.find(job.companyId, job.documentId)
      : null;
    if (!document) {
      return stop(
        job,
        { code: "RIDE_DOCUMENT_NOT_FOUND", errorClass: "DETERMINISTIC" },
        context.now(),
      );
    }
    if (document.state !== "AUTHORIZED" || !document.authorization) {
      return stop(
        job,
        { code: "RIDE_DOCUMENT_NOT_AUTHORIZED", errorClass: "DETERMINISTIC" },
        context.now(),
      );
    }
    // Generado una vez: con un RIDE guardado, el job termina sin generar otro.
    if (await deps.artifacts.summary(document.companyId, document.id, "RIDE_PDF")) {
      await jobs.complete(deps.db, job, context.now());
      return;
    }
    if (context.signal.aborted) {
      const now = context.now();
      await jobs.reschedule(deps.db, job, { at: now, now, consumeAttempt: false });
      return;
    }

    let prepared;
    try {
      const facts = snapshotFacts(document.snapshot, document.documentType);
      const { artifact, provenance } = await source(document);
      const logo = await logoOf(document, facts.configVersionId);
      prepared = { facts, artifact, provenance, logo };
    } catch (error) {
      if (error instanceof RideStop) return stop(job, error.error, context.now());
      throw error;
    }

    const started = context.now();
    deps.observer?.waited(Math.max(0, (started.getTime() - job.nextAttemptAt.getTime()) / 1_000));
    let outcome;
    try {
      outcome = await deps.renderer.render({
        xml: prepared.artifact.content,
        accessKey: document.accessKey,
        authorization: {
          number: document.authorization.number,
          authorizedAt: document.authorization.date,
          environment: document.authorization.environment,
        },
        paymentLabels: prepared.facts.paymentLabels,
        ...(prepared.facts.withholdingLabels
          ? { withholdingLabels: prepared.facts.withholdingLabels }
          : {}),
        logo: prepared.logo?.logo ?? null,
      });
    } catch (error) {
      if (!(error instanceof RideRenderUnavailableError)) throw error;
      deps.observer?.failed(error.reason);
      const now = context.now();
      if (error.reason === "BUSY" || error.reason === "CLOSED") {
        // Ocupado o apagándose: nadie dibujó nada, así que el intento no se gasta.
        const at = new Date(now.getTime() + (error.reason === "BUSY" ? RIDE_BUSY_DELAY_MS : 0));
        await jobs.reschedule(deps.db, job, { at, now, consumeAttempt: false });
        return;
      }
      const status = await jobs.fail(
        deps.db,
        job,
        { code: `RIDE_RENDER_${error.reason}`, errorClass: "RETRYABLE" },
        { backoff: deps.settings.backoff, now, ...(deps.random ? { random: deps.random } : {}) },
      );
      logger.warn(
        { jobId: job.id, documentId: document.id, reason: error.reason, status },
        "el render del RIDE falló",
      );
      return;
    }

    if (outcome.status === "REJECTED") {
      return stop(
        job,
        {
          code: outcome.code,
          errorClass: "DETERMINISTIC",
          ...(outcome.detail.length > 0
            ? { detail: { items: outcome.detail.join(",").slice(0, 500) } }
            : {}),
        },
        context.now(),
      );
    }
    deps.observer?.rendered(outcome.renderMs / 1_000);

    const metadata = {
      ...outcome.versions,
      pages: outcome.pages,
      source: {
        kind: prepared.artifact.kind,
        sha256: prepared.artifact.sha256,
        provenance: prepared.provenance,
      },
      logo: prepared.logo ? { sha256: prepared.logo.sha256 } : null,
      authorizationNumber: document.authorization.number,
      jobId: job.id,
    };
    const now = context.now();
    try {
      await deps.uow.run(async (scope) => {
        await scope.artifacts.save({
          companyId: document.companyId,
          documentId: document.id,
          kind: "RIDE_PDF",
          mediaType: "application/pdf",
          content: Buffer.from(outcome.pdf),
          metadata,
        });
        await jobs.complete(scope.db, job, now);
      });
    } catch (error) {
      // Otra ejecución guardó el RIDE entre tanto: UNIQUE (document_id, kind) impide un segundo.
      if (!isUniqueViolation(error)) throw error;
      await jobs.complete(deps.db, job, now);
      logger.info({ jobId: job.id, documentId: document.id }, "el RIDE ya estaba guardado");
      return;
    }
    logger.info(
      {
        jobId: job.id,
        documentId: document.id,
        provenance: prepared.provenance,
        pages: outcome.pages,
        renderMs: Math.round(outcome.renderMs),
      },
      "RIDE generado",
    );
  }

  return { run, backoff: deps.settings.backoff };
}

/** Choque con una restricción única de Prisma (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

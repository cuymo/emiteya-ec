// Handler del trabajo `email.send_document` (add-email-delivery, design D3 a D7; spec email-delivery,
// «Estados del envío» y «Reintentos de los fallos temporales»).
//
//   envío PENDING/RETRYING ─▶ ¿envío encendido? ─no─▶ DISABLED
//        │ sí
//        ▼
//   servidor de la empresa, comprobante autorizado, destinatarios (los guardados o los del tercero;
//   en Pruebas, el correo de prueba), XML y RIDE verificados por SHA-256, contraseña abierta
//        ▼
//   SMTP ─▶ aceptado: SENT │ temporal: RETRYING con backoff, FAILED al agotarse │ definitivo: FAILED
//
// Cada intento queda como fila de solo agregado, en la transacción que confirma el trabajo. Un fallo
// nunca cambia el estado fiscal del comprobante. Los motivos son de una tabla cerrada; el detalle
// técnico del servidor se guarda recortado y sin la contraseña solo en el intento.
import type { Job, JobStore } from "../../../platform/jobs/jobs.ts";
import type { JobHandler } from "../../../platform/jobs/runner.ts";
import {
  failureClass,
  failureMessage,
  type EmailFailure,
  type EmailFailureCode,
} from "../domain/failures.ts";
import { composeMessage, messageIdOf, verifiedBytes } from "../domain/message.ts";
import { receiversOf, resolveRecipients } from "../domain/recipients.ts";
import type { EmailJobSettings } from "./automatic.ts";
import {
  SmtpPasswordUnavailableError,
  type DeliverableDocumentReader,
  type DeliveryRecipient,
  type EmailDeliveryRecord,
  type EmailDeliveryRepository,
  type EmailDeliveryUnitOfWork,
  type EmailDeploymentPolicy,
  type EmailObserver,
  type EmailSettingsRepository,
  type MailTransport,
  type PartyEmailReader,
  type SmtpConnection,
  type SmtpPasswordVault,
} from "./ports.ts";

export type SendHandlerDependencies = Readonly<{
  deliveries: Pick<EmailDeliveryRepository, "find">;
  settings: Pick<EmailSettingsRepository, "find" | "findSecret">;
  documents: DeliverableDocumentReader;
  parties: PartyEmailReader;
  vault: SmtpPasswordVault | null;
  transport: MailTransport;
  uow: EmailDeliveryUnitOfWork;
  jobs: Pick<JobStore, "complete" | "fail">;
  policy: EmailDeploymentPolicy;
  settingsOfJob: EmailJobSettings;
  observer?: EmailObserver;
  logger: Readonly<{
    info(details: object, message: string): void;
    warn(details: object, message: string): void;
  }>;
  random?: () => number;
}>;

/** Un envío que termina sin intentar el SMTP: desactivado, sin destinatario o fallido antes. */
class Finish extends Error {
  readonly status: "DISABLED" | "NO_RECIPIENT" | "FAILED";
  readonly code: EmailFailureCode;
  readonly testRedirect: boolean | undefined;
  constructor(
    status: "DISABLED" | "NO_RECIPIENT" | "FAILED",
    code: EmailFailureCode,
    testRedirect?: boolean,
  ) {
    super(code);
    this.name = "Finish";
    this.status = status;
    this.code = code;
    this.testRedirect = testRedirect;
  }
}

const deliveryIdOf = (job: Job) =>
  typeof job.payload.deliveryId === "string" ? job.payload.deliveryId : null;

const pending = (addresses: readonly string[]): DeliveryRecipient[] =>
  addresses.map((address) => ({ address, outcome: null, reason: null }));

export function createSendDocumentHandler(deps: SendHandlerDependencies): JobHandler {
  const observe = (outcome: Parameters<EmailObserver["finished"]>[0]) =>
    deps.observer?.finished(outcome);

  async function recipientsOf(
    delivery: EmailDeliveryRecord,
    document: NonNullable<Awaited<ReturnType<DeliverableDocumentReader["find"]>>>,
    testRecipient: string | null,
  ): Promise<{ recipients: DeliveryRecipient[]; testRedirect: boolean }> {
    // Los del reenvío, o los resueltos en un intento anterior: el envío conserva sus direcciones.
    if (delivery.recipients.length > 0) {
      return {
        recipients: pending(delivery.recipients.map((r) => r.address)),
        testRedirect: delivery.testRedirect,
      };
    }
    const receivers = receiversOf(
      document.documentType,
      document.snapshot,
      document.invoiceSnapshot,
    );
    const emailsByParty =
      delivery.environment === "TEST" || receivers.partyIds.length === 0
        ? new Map<string, readonly string[]>()
        : await deps.parties.emailsOf(delivery.companyId, receivers.partyIds);
    const resolved = resolveRecipients({
      environment: delivery.environment,
      receivers,
      emailsByParty,
      testRecipient,
    });
    if (resolved.kind === "NONE")
      throw new Finish("NO_RECIPIENT", resolved.reason, resolved.testRedirect);
    return { recipients: pending(resolved.addresses), testRedirect: resolved.testRedirect };
  }

  async function connectionOf(
    companyId: string,
    settings: NonNullable<Awaited<ReturnType<EmailSettingsRepository["find"]>>>,
  ): Promise<SmtpConnection> {
    let password: string | null = null;
    if (settings.username !== null) {
      const sealed = await deps.settings.findSecret(companyId);
      if (sealed === null || deps.vault === null)
        throw new Finish("FAILED", "PASSWORD_UNAVAILABLE");
      try {
        password = deps.vault.open(sealed, companyId);
      } catch (error) {
        if (error instanceof SmtpPasswordUnavailableError) {
          throw new Finish("FAILED", "PASSWORD_UNAVAILABLE");
        }
        throw error;
      }
    }
    return {
      host: settings.host,
      port: settings.port,
      security: settings.security,
      username: settings.username,
      password,
    };
  }

  /** Cierra un envío sin intento SMTP y completa el trabajo, en una transacción. */
  async function finish(job: Job, delivery: EmailDeliveryRecord, reason: Finish, now: Date) {
    await deps.uow.run(async (scope) => {
      await scope.deliveries.update(delivery.companyId, delivery.id, {
        status: reason.status,
        failureCode: reason.code,
        failureReason: failureMessage(reason.code),
        ...(reason.testRedirect !== undefined ? { testRedirect: reason.testRedirect } : {}),
        finishedAt: now,
      });
      await deps.jobs.complete(scope.db, job, now);
    });
    observe(
      reason.status === "DISABLED"
        ? "disabled"
        : reason.status === "NO_RECIPIENT"
          ? "no_recipient"
          : "failed",
    );
  }

  async function failed(
    job: Job,
    delivery: EmailDeliveryRecord,
    failure: EmailFailure,
    sent: Readonly<{ recipients: DeliveryRecipient[]; testRedirect: boolean }>,
    now: Date,
  ) {
    const attempt = {
      number: delivery.attemptCount + 1,
      at: now,
      smtpCode: failure.smtpCode,
      detail: failure.detail || null,
    };
    const reason = failureMessage(failure.code);
    const retryable = failureClass(failure.code) === "RETRYABLE";
    const status = await deps.uow.run(async (scope) => {
      let final = !retryable;
      if (retryable) {
        const jobStatus = await deps.jobs.fail(
          scope.db,
          job,
          { code: `EMAIL_${failure.code}`, errorClass: "RETRYABLE" },
          {
            backoff: deps.settingsOfJob.backoff,
            now,
            ...(deps.random ? { random: deps.random } : {}),
          },
        );
        final = jobStatus === "STOPPED";
      } else {
        await deps.jobs.complete(scope.db, job, now);
      }
      await scope.deliveries.recordAttempt(
        delivery.companyId,
        delivery.id,
        { ...attempt, outcome: retryable ? "RETRYABLE" : "DETERMINISTIC" },
        {
          status: final ? "FAILED" : "RETRYING",
          recipients: sent.recipients,
          testRedirect: sent.testRedirect,
          failureCode: failure.code,
          failureReason: reason,
          finishedAt: final ? now : null,
        },
      );
      return final ? "failed" : "retrying";
    });
    observe(status);
    deps.logger.warn(
      {
        deliveryId: delivery.id,
        documentId: delivery.documentId,
        code: failure.code,
        final: status === "failed",
      },
      "envío por correo fallido",
    );
  }

  return {
    backoff: deps.settingsOfJob.backoff,
    async run(job, context) {
      const now = context.now();
      const deliveryId = deliveryIdOf(job);
      const delivery = deliveryId ? await deps.deliveries.find(job.companyId, deliveryId) : null;
      if (!delivery || (delivery.status !== "PENDING" && delivery.status !== "RETRYING")) {
        await deps.uow.run((scope) => deps.jobs.complete(scope.db, job, now));
        return;
      }
      try {
        if (!deps.policy.deliveryEnabled) throw new Finish("DISABLED", "DELIVERY_DISABLED");
        const settings = await deps.settings.find(delivery.companyId);
        if (settings === null) throw new Finish("FAILED", "NOT_CONFIGURED");
        const document = await deps.documents.find(delivery.companyId, delivery.documentId);
        if (!document || document.state !== "AUTHORIZED" || document.authorization === null) {
          throw new Finish("FAILED", "ARTIFACT_MISSING");
        }
        const sent = await recipientsOf(delivery, document, settings.testRecipient);
        const files = await deps.documents.attachments(delivery.companyId, delivery.documentId);
        const xml = verifiedBytes(files.xml);
        const ride = verifiedBytes(files.ride);
        if (xml === null || ride === null) throw new Finish("FAILED", "ARTIFACT_MISSING");
        const connection = await connectionOf(delivery.companyId, settings);

        const message = composeMessage({
          documentType: document.documentType,
          documentNumber: document.documentNumber,
          issueDate: document.issueDate,
          accessKey: document.accessKey,
          authorizationNumber: document.authorization.number,
          environment: delivery.environment,
          issuerName: document.issuerName,
          receiverName: document.receiverName,
          total: document.total,
        });
        const [xmlName, rideName] = message.attachments;
        const messageId = messageIdOf(delivery.id, settings.fromAddress);
        const started = performance.now();
        const outcome = await deps.transport.send(connection, {
          from: { name: settings.fromName, address: settings.fromAddress },
          to: sent.recipients.map((recipient) => recipient.address),
          bcc: settings.bccAddress,
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: [
            { filename: xmlName!.filename, contentType: xmlName!.contentType, content: xml },
            { filename: rideName!.filename, contentType: rideName!.contentType, content: ride },
          ],
          messageId,
        });
        deps.observer?.sendDuration((performance.now() - started) / 1000);
        const at = context.now();

        if (outcome.kind === "FAILED") {
          await failed(job, delivery, outcome.failure, sent, at);
          return;
        }
        const accepted = new Set(outcome.accepted.map((address) => address.toLowerCase()));
        const rejected = new Map(
          outcome.rejected.map((r) => [r.address.toLowerCase(), r.smtpCode] as const),
        );
        const recipients = sent.recipients.map((recipient): DeliveryRecipient => {
          const key = recipient.address.toLowerCase();
          if (accepted.has(key)) return { ...recipient, outcome: "ACCEPTED" };
          const code = rejected.get(key) ?? null;
          return {
            ...recipient,
            outcome: "REJECTED",
            reason: `El servidor de correo rechazó esta dirección${code ? ` (${code})` : ""}.`,
          };
        });
        if (accepted.size === 0) {
          await failed(
            job,
            delivery,
            { code: "ALL_RECIPIENTS_REJECTED", smtpCode: outcome.smtpCode, detail: "" },
            { ...sent, recipients },
            at,
          );
          return;
        }
        await deps.uow.run(async (scope) => {
          await deps.jobs.complete(scope.db, job, at);
          await scope.deliveries.recordAttempt(
            delivery.companyId,
            delivery.id,
            {
              number: delivery.attemptCount + 1,
              at,
              outcome: "SENT",
              smtpCode: outcome.smtpCode,
              detail: null,
            },
            {
              status: "SENT",
              recipients,
              testRedirect: sent.testRedirect,
              failureCode: null,
              failureReason: null,
              messageId,
              sentAt: at,
              finishedAt: at,
            },
          );
        });
        observe("sent");
        deps.logger.info(
          { deliveryId: delivery.id, documentId: delivery.documentId },
          "correo enviado",
        );
      } catch (error) {
        if (error instanceof Finish) {
          await finish(job, delivery, error, context.now());
          return;
        }
        throw error;
      }
    },
  };
}

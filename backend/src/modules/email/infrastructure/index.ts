// Composición del módulo de correo (add-email-delivery, design D1). La contraseña SMTP usa la clave
// maestra de custodia de la firma (design D9); sin custodia, no se pueden guardar contraseñas.
import type { Registry } from "@prometheus-io/client";
import type { CertificateCustodyConfig } from "../../../config/env.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import type { JobHandler } from "../../../platform/jobs/runner.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import {
  EMAIL_SEND_JOB_TYPE,
  emailRideFollower,
  type EmailJobSettings,
} from "../application/automatic.ts";
import type {
  DeliverableDocumentReader,
  EmailDeploymentPolicy,
  MailTransport,
  PartyEmailReader,
} from "../application/ports.ts";
import { createDocumentDeliveries } from "../application/document-deliveries.ts";
import { createSendDocumentHandler } from "../application/send-handler.ts";
import { createEmailSettings } from "../application/settings.ts";
import { createPasswordResetEmail } from "../application/password-reset-email.ts";
import { createTestEmail } from "../application/test-email.ts";
import { emailRouter } from "./http/email-router.ts";
import { createSmtpPasswordVault } from "./password-vault.ts";
import { createEmailSettingsRepository } from "./prisma-email-settings.ts";
import { createSmtpMailTransport } from "./smtp-transport.ts";
import { createEmailStatusSource } from "./email-status-source.ts";
import { createEmailUnitOfWork } from "./unit-of-work.ts";
import { createEmailDeliveryUnitOfWork } from "./delivery-unit-of-work.ts";
import { registerEmailMetrics } from "./metrics.ts";
import { createEmailDeliveryRepository } from "./prisma-email-deliveries.ts";

export type EmailModuleOptions = Readonly<{
  prisma: PrismaClient;
  authorizer: Authorizer;
  custody: CertificateCustodyConfig;
  policy: EmailDeploymentPolicy;
  smtp: Readonly<{ connectionTimeoutMs: number; socketTimeoutMs: number }>;
  /** Solo para las pruebas: otro transporte, como uno que confía en un certificado de prueba. */
  transport?: MailTransport;
  now?: () => Date;
  /** El esquema de la conexión, para el SQL que califica sus tablas (como la cola). */
  schema?: string;
  /** El envío de los comprobantes: su cola y las fuentes que exportan `fiscal` y `parties`. */
  delivery: Readonly<{
    jobs: JobStore;
    documents: DeliverableDocumentReader;
    parties: PartyEmailReader;
    job: EmailJobSettings;
    metrics?: Registry;
    logger: Readonly<{
      info(details: object, message: string): void;
      warn(details: object, message: string): void;
    }>;
    random?: () => number;
  }>;
}>;

export function emailModule(options: EmailModuleOptions) {
  const { custody } = options;
  const vault = custody.enabled
    ? createSmtpPasswordVault({
        activeVersion: custody.keyVersion,
        keys: new Map([[custody.keyVersion, custody.key]]),
      })
    : null;
  const repository = createEmailSettingsRepository(options.prisma);
  const uow = createEmailUnitOfWork(options.prisma);
  const transport =
    options.transport ??
    createSmtpMailTransport({
      ...options.smtp,
      plaintextAllowed: options.policy.plaintextAllowed,
    });
  const settings = createEmailSettings({
    settings: repository,
    uow,
    authorizer: options.authorizer,
    vault,
    policy: options.policy,
  });
  const testEmail = createTestEmail({
    settings: repository,
    uow,
    authorizer: options.authorizer,
    vault,
    transport,
    policy: options.policy,
    ...(options.now ? { now: options.now } : {}),
  });
  const schema = options.schema ?? "public";
  const { delivery } = options;
  const deliveries = createEmailDeliveryRepository(options.prisma, schema);
  const deliveryUow = createEmailDeliveryUnitOfWork(options.prisma, schema);
  const rideFollowers = [
    emailRideFollower({
      repositories: (db) => ({
        deliveries: createEmailDeliveryRepository(db, schema),
        settings: createEmailSettingsRepository(db),
      }),
      jobs: delivery.jobs,
      policy: options.policy,
      settings: delivery.job,
    }),
  ];
  const handlers: Record<string, JobHandler> = {
    [EMAIL_SEND_JOB_TYPE]: createSendDocumentHandler({
      deliveries,
      settings: repository,
      documents: delivery.documents,
      parties: delivery.parties,
      vault,
      transport,
      uow: deliveryUow,
      jobs: delivery.jobs,
      policy: options.policy,
      settingsOfJob: delivery.job,
      ...(delivery.metrics
        ? { observer: registerEmailMetrics(delivery.metrics, options.policy) }
        : {}),
      logger: delivery.logger,
      ...(delivery.random ? { random: delivery.random } : {}),
    }),
  };
  const documents = createDocumentDeliveries({
    deliveries,
    uow: deliveryUow,
    settings: repository,
    documents: delivery.documents,
    parties: delivery.parties,
    jobs: delivery.jobs,
    authorizer: options.authorizer,
    policy: options.policy,
    jobSettings: delivery.job,
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    routers: [emailRouter({ settings, testEmail, documents })],
    settings,
    transport,
    rideFollowers,
    handlers,
    /** El estado del correo de los comprobantes, para la bandeja y el tablero. */
    statuses: createEmailStatusSource(options.prisma, schema),
    /** El enlace de recuperación de la contraseña (add-password-reset-by-email). */
    passwordReset: createPasswordResetEmail({
      settings: repository,
      vault,
      transport,
      policy: options.policy,
    }),
  };
}

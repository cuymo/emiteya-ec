// Composición del módulo de correo (add-email-delivery, design D1). La contraseña SMTP usa la clave
// maestra de custodia de la firma (design D9); sin custodia, no se pueden guardar contraseñas.
import type { Registry } from "@prometheus-io/client";
import type { CertificateCustodyConfig } from "../../../config/env.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { JobStore } from "../../../platform/jobs/jobs.ts";
import type { JobHandler } from "../../../platform/jobs/runner.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import {
  EMAIL_SEND_JOB_TYPE,
  emailRideFollower,
  type AuthorizedDocumentRef,
  type EmailJobSettings,
} from "../application/automatic.ts";
import type {
  DeliverableDocumentReader,
  EmailDeploymentPolicy,
  MailTransport,
  PartyEmailReader,
} from "../application/ports.ts";
import { createSendDocumentHandler } from "../application/send-handler.ts";
import { createEmailSettings } from "../application/settings.ts";
import { createTestEmail } from "../application/test-email.ts";
import { emailRouter } from "./http/email-router.ts";
import { createSmtpPasswordVault } from "./password-vault.ts";
import { createEmailSettingsRepository } from "./prisma-email-settings.ts";
import { createSmtpMailTransport } from "./smtp-transport.ts";
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
  delivery?: Readonly<{
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
  const rideFollowers: ((
    db: DbClient,
    document: AuthorizedDocumentRef,
    at: Date,
  ) => Promise<void>)[] = delivery
    ? [
        emailRideFollower({
          repositories: (db) => ({
            deliveries: createEmailDeliveryRepository(db, schema),
            settings: createEmailSettingsRepository(db),
          }),
          jobs: delivery.jobs,
          policy: options.policy,
          settings: delivery.job,
        }),
      ]
    : [];
  const handlers: Record<string, JobHandler> = delivery
    ? {
        [EMAIL_SEND_JOB_TYPE]: createSendDocumentHandler({
          deliveries: createEmailDeliveryRepository(options.prisma, schema),
          settings: repository,
          documents: delivery.documents,
          parties: delivery.parties,
          vault,
          transport,
          uow: createEmailDeliveryUnitOfWork(options.prisma, schema),
          jobs: delivery.jobs,
          policy: options.policy,
          settingsOfJob: delivery.job,
          ...(delivery.metrics
            ? { observer: registerEmailMetrics(delivery.metrics, options.policy) }
            : {}),
          logger: delivery.logger,
          ...(delivery.random ? { random: delivery.random } : {}),
        }),
      }
    : {};
  return {
    routers: [emailRouter({ settings, testEmail })],
    settings,
    transport,
    rideFollowers,
    handlers,
  };
}

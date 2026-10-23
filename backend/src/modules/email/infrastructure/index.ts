// Composición del módulo de correo (add-email-delivery, design D1). La contraseña SMTP usa la clave
// maestra de custodia de la firma (design D9); sin custodia, no se pueden guardar contraseñas.
import type { CertificateCustodyConfig } from "../../../config/env.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { EmailDeploymentPolicy, MailTransport } from "../application/ports.ts";
import { createEmailSettings } from "../application/settings.ts";
import { createTestEmail } from "../application/test-email.ts";
import { emailRouter } from "./http/email-router.ts";
import { createSmtpPasswordVault } from "./password-vault.ts";
import { createEmailSettingsRepository } from "./prisma-email-settings.ts";
import { createSmtpMailTransport } from "./smtp-transport.ts";
import { createEmailUnitOfWork } from "./unit-of-work.ts";

export type EmailModuleOptions = Readonly<{
  prisma: PrismaClient;
  authorizer: Authorizer;
  custody: CertificateCustodyConfig;
  policy: EmailDeploymentPolicy;
  smtp: Readonly<{ connectionTimeoutMs: number; socketTimeoutMs: number }>;
  /** Solo para las pruebas: otro transporte, como uno que confía en un certificado de prueba. */
  transport?: MailTransport;
  now?: () => Date;
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
  return { routers: [emailRouter({ settings, testEmail })], settings, transport };
}

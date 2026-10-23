// Composición del módulo de correo (add-email-delivery, design D1). La contraseña SMTP usa la clave
// maestra de custodia de la firma (design D9); sin custodia, no se pueden guardar contraseñas.
import type { CertificateCustodyConfig } from "../../../config/env.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import type { EmailDeploymentPolicy } from "../application/ports.ts";
import { createEmailSettings } from "../application/settings.ts";
import { emailRouter } from "./http/email-router.ts";
import { createSmtpPasswordVault } from "./password-vault.ts";
import { createEmailSettingsRepository } from "./prisma-email-settings.ts";
import { createEmailUnitOfWork } from "./unit-of-work.ts";

export type EmailModuleOptions = Readonly<{
  prisma: PrismaClient;
  authorizer: Authorizer;
  custody: CertificateCustodyConfig;
  policy: EmailDeploymentPolicy;
}>;

export function emailModule(options: EmailModuleOptions) {
  const { custody } = options;
  const vault = custody.enabled
    ? createSmtpPasswordVault({
        activeVersion: custody.keyVersion,
        keys: new Map([[custody.keyVersion, custody.key]]),
      })
    : null;
  const settings = createEmailSettings({
    settings: createEmailSettingsRepository(options.prisma),
    uow: createEmailUnitOfWork(options.prisma),
    authorizer: options.authorizer,
    vault,
    policy: options.policy,
  });
  return { routers: [emailRouter(settings)], settings };
}

// App de pruebas del correo (add-email-delivery): la autenticación real y el módulo de correo con
// la política del despliegue y la custodia de cada prueba.
import { Router } from "express";
import type { CertificateCustodyConfig } from "../../src/config/env.ts";
import type { EmailDeploymentPolicy } from "../../src/modules/email/application/ports.ts";
import { emailModule } from "../../src/modules/email/infrastructure/index.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { buildAuthApp } from "./auth-harness.ts";
import type { MigratedSchema } from "./database.ts";

export const TEST_CUSTODY: CertificateCustodyConfig = {
  enabled: true,
  keyVersion: "1",
  key: Buffer.alloc(32, 5),
};

export type EmailHarnessOptions = {
  policy?: Partial<EmailDeploymentPolicy>;
  custody?: CertificateCustodyConfig;
};

export function buildEmailApp(db: MigratedSchema, options: EmailHarnessOptions = {}) {
  return buildAuthApp(db, {
    trustProxy: 1,
    apiRouter: ({ context, memberships, securityEvents }) => {
      const authorizer = createAuthorizer({ memberships, securityEvents });
      const email = emailModule({
        prisma: db.database.prisma,
        authorizer,
        custody: options.custody ?? TEST_CUSTODY,
        policy: { deliveryEnabled: false, plaintextAllowed: false, ...options.policy },
      });
      return Router()
        .use(context)
        .use(...email.routers);
    },
  });
}

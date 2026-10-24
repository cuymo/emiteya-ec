// App de pruebas del correo (add-email-delivery): la autenticación real y el módulo de correo con
// la política del despliegue y la custodia de cada prueba.
import { Router } from "express";
import type { CertificateCustodyConfig } from "../../src/config/env.ts";
import type { EmailDeploymentPolicy } from "../../src/modules/email/application/ports.ts";
import { emailModule } from "../../src/modules/email/infrastructure/index.ts";
import { createDeliverableDocumentSource } from "../../src/modules/fiscal/infrastructure/archive/deliverable-documents.ts";
import { createPartyEmailSource } from "../../src/modules/parties/infrastructure/party-email-source.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
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
  now?: () => Date;
  /** La recuperación de la contraseña enviada con este módulo (add-password-reset-by-email). */
  passwordReset?: { publicOrigin: string };
};

export function buildEmailApp(db: MigratedSchema, options: EmailHarnessOptions = {}) {
  let built: ReturnType<typeof emailModule> | undefined;
  const app = buildAuthApp(db, {
    trustProxy: 1,
    ...(options.passwordReset
      ? {
          passwordReset: {
            publicOrigin: options.passwordReset.publicOrigin,
            mailer: { send: (input) => email().passwordReset.send(input) },
          },
        }
      : {}),
    apiRouter: ({ context, memberships, securityEvents }) => {
      const authorizer = createAuthorizer({ memberships, securityEvents });
      const email = emailModule({
        prisma: db.database.prisma,
        authorizer,
        custody: options.custody ?? TEST_CUSTODY,
        policy: { deliveryEnabled: false, plaintextAllowed: false, ...options.policy },
        smtp: { connectionTimeoutMs: 2_000, socketTimeoutMs: 5_000 },
        ...(options.now ? { now: options.now } : {}),
        schema: db.name,
        delivery: {
          jobs: createPrismaJobStore(db.database.prisma, db.name),
          documents: createDeliverableDocumentSource(db.database.prisma),
          parties: createPartyEmailSource(db.database.prisma),
          job: {
            maxAttempts: 3,
            backoff: { baseMs: 1, capMs: 1, minMs: 1 },
            deadlineMs: 86_400_000,
          },
          logger: { info: () => {}, warn: () => {} },
        },
      });
      built = email;
      return Router()
        .use(context)
        .use(...email.routers);
    },
  });
  /** El módulo construido con la app: su cola de correos para ejecutarla en las pruebas. */
  const email = () => {
    if (!built) throw new Error("el módulo de correo todavía no se construyó");
    return built;
  };
  return { ...app, email };
}

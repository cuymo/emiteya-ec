// Arnés HTTP del archivo documental (add-document-archive): la aplicación real con Better Auth, el
// contexto de petición y los routers de la bandeja, con dos empresas y usuarios que inician sesión.
import { Registry } from "@prometheus-io/client";
import { Router } from "express";
import {
  RIDE_BACKOFF,
  archiveRouters,
} from "../../src/modules/fiscal/infrastructure/archive/index.ts";
import { createPrismaJobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { buildAuthApp, createMember } from "./auth-harness.ts";
import type { MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { sessionCookie } from "./taxpayer-harness.ts";

export function buildArchiveApp(db: MigratedSchema) {
  const archiveMetrics = new Registry();
  const errors: { details: object; message: string }[] = [];
  const app = buildAuthApp(db, {
    trustProxy: 1,
    apiRouter: ({ context, memberships, securityEvents }) => {
      const authorizer = createAuthorizer({ memberships, securityEvents });
      return Router()
        .use(context)
        .use(
          ...archiveRouters({
            prisma: db.database.prisma,
            authorizer,
            jobs: createPrismaJobStore(db.database.prisma, db.name),
            rideSettings: { maxAttempts: 5, backoff: RIDE_BACKOFF },
            metrics: archiveMetrics,
            logger: { error: (details, message) => void errors.push({ details, message }) },
          }),
        );
    },
  });
  return { ...app, archiveMetrics, errors };
}

export type ArchiveCompany = FiscalCompany &
  Readonly<{ cookies: { admin: string; operator: string }; operatorId: string }>;

let counter = 0;
/** Empresa con tres puntos, y un administrador y un operador que inician sesión. */
export async function archiveCompany(
  db: MigratedSchema,
  app: ReturnType<typeof buildArchiveApp>,
  name: string,
): Promise<ArchiveCompany> {
  const company = await insertFiscalCompany(db.database.prisma, name, 3);
  counter++;
  const admin = `admin-${counter}@archivo.ec`;
  const operator = `operador-${counter}@archivo.ec`;
  await createMember(app.uow, company.companyId, {
    name: `Admin ${name}`,
    email: admin,
    role: "ADMIN",
  });
  const operatorId = await createMember(app.uow, company.companyId, {
    name: `Operador ${name}`,
    email: operator,
    role: "OPERATOR",
  });
  return {
    ...company,
    operatorId,
    cookies: {
      admin: await sessionCookie(app.app, admin),
      operator: await sessionCookie(app.app, operator),
    },
  };
}

// Arnés HTTP del archivo documental (add-document-archive): la aplicación real con Better Auth, el
// contexto de petición y los routers de la bandeja, con dos empresas y usuarios que inician sesión.
import { Router } from "express";
import { archiveRouters } from "../../src/modules/fiscal/infrastructure/archive/index.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { buildAuthApp, createMember } from "./auth-harness.ts";
import type { MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { sessionCookie } from "./taxpayer-harness.ts";

export function buildArchiveApp(db: MigratedSchema) {
  return buildAuthApp(db, {
    trustProxy: 1,
    apiRouter: ({ context, memberships, securityEvents }) => {
      const authorizer = createAuthorizer({ memberships, securityEvents });
      return Router()
        .use(context)
        .use(...archiveRouters({ prisma: db.database.prisma, authorizer }));
    },
  });
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

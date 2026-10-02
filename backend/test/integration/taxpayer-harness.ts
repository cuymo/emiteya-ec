// Arnés HTTP del módulo taxpayer: la aplicación real con Better Auth, el contexto de petición de
// design D3 y los routers de usuarios y de taxpayer montados como en main.ts.
import { randomInt } from "node:crypto";
import { Router } from "express";
import { userSchemas } from "@facturador/contracts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { createUserAdministration } from "../../src/modules/identity/application/user-administration.ts";
import { usersRouter } from "../../src/modules/identity/infrastructure/http/users-router.ts";
import { taxpayerRouters } from "../../src/modules/taxpayer/infrastructure/index.ts";
import { PASSWORD, buildAuthApp, signIn, type AuthApp } from "./auth-harness.ts";
import type { MigratedSchema } from "./database.ts";

export const TEST_LOGO_MAX_BYTES = 64 * 1024;

export function buildTaxpayerApp(db: MigratedSchema, options: { logoMaxBytes?: number } = {}) {
  return buildAuthApp(db, {
    trustProxy: 1,
    apiRouter: ({ context, memberships, securityEvents, uow }) => {
      const authorizer = createAuthorizer({ memberships, securityEvents });
      return Router()
        .use(context)
        .use(
          usersRouter(
            createUserAdministration({ uow, memberships, authorizer, schemas: userSchemas() }),
          ),
        )
        .use(
          ...taxpayerRouters({
            prisma: db.database.prisma,
            authorizer,
            logoMaxBytes: options.logoMaxBytes ?? TEST_LOGO_MAX_BYTES,
          }),
        );
    },
  });
}

/** Abre una sesión desde una IP propia, para no compartir el límite nativo por IP entre pruebas. */
export async function sessionCookie(app: AuthApp["app"], email: string): Promise<string> {
  const ip = `10.${randomInt(1, 254)}.${randomInt(1, 254)}.${randomInt(1, 254)}`;
  const { status, cookie } = await signIn(app, email, PASSWORD, { "X-Forwarded-For": ip });
  if (status !== 200) throw new Error(`No se pudo iniciar sesión como ${email}: ${status}`);
  return cookie;
}

// Arranque y apagado del backend. Desarrollo: node --conditions=development src/main.ts (ADR 0016).
import { randomUUID } from "node:crypto";
import { userSchemas } from "@facturador/contracts";
import { Router } from "express";
import { createApp } from "./app.ts";
import { EnvError, loadEnv, loadInitialAdmin, passwordPolicy, type Env } from "./config/env.ts";
import { createAuthorizer } from "./modules/identity/application/authorization.ts";
import { provisionInstallation } from "./modules/identity/application/provisioning.ts";
import { createUserAdministration } from "./modules/identity/application/user-administration.ts";
import {
  authSettingsFromEnv,
  createAuth,
  createUnitOfWork,
  getSessionUserId,
  mountAuth,
} from "./modules/identity/infrastructure/better-auth/index.ts";
import { requireContext } from "./modules/identity/infrastructure/http/request-context.ts";
import { usersRouter } from "./modules/identity/infrastructure/http/users-router.ts";
import { createCompanyReader } from "./modules/identity/infrastructure/prisma-companies.ts";
import { createMembershipReader } from "./modules/identity/infrastructure/prisma-memberships.ts";
import { createSecurityEventLog } from "./modules/identity/infrastructure/security-event-log.ts";
import { createDatabase } from "./platform/db/database.ts";
import { createShutdown, type Closer } from "./platform/lifecycle/shutdown.ts";
import { createLogger } from "./platform/logging/logger.ts";
import { createMetrics } from "./platform/metrics/metrics.ts";

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = loadEnvOrExit();
const logger = createLogger(env.LOG_LEVEL);
const database = createDatabase(env.DATABASE_URL);
const closers: Closer[] = [{ name: "database", close: database.close }];

const metrics = createMetrics();
const securityEvents = createSecurityEventLog(logger, metrics.registry);
const authSettings = authSettingsFromEnv(env);
const auth = createAuth({ prisma: database.prisma, settings: authSettings, securityEvents });
const uow = createUnitOfWork(database.prisma, auth, authSettings);
const memberships = createMembershipReader(database.prisma);

// Aprovisionamiento antes de aceptar tráfico (design D7).
try {
  const result = await provisionInstallation({
    uow,
    companies: createCompanyReader(database.prisma),
    initialAdmin: () => loadInitialAdmin(env),
    correlationId: `startup-${randomUUID()}`,
  });
  if (result === "provisioned")
    logger.info("instalación aprovisionada: empresa y administrador inicial creados");
} catch (error) {
  if (error instanceof EnvError) console.error(error.message);
  else logger.fatal({ err: error }, "el aprovisionamiento falló");
  await database.close();
  process.exit(1);
}

// Toda ruta de /api/v1 exige sesión y membresía activa; el contexto se resuelve en el servidor (D3).
const apiRouter = Router();
apiRouter.use(
  requireContext({ getSessionUserId: (headers) => getSessionUserId(auth, headers), memberships }),
);
apiRouter.use(
  usersRouter(
    createUserAdministration({
      uow,
      memberships,
      authorizer: createAuthorizer({ memberships, securityEvents }),
      schemas: userSchemas(passwordPolicy(env)),
    }),
  ),
);

const app = createApp({
  logger,
  metrics,
  readiness: () => database.ping(),
  trustProxy: env.TRUST_PROXY,
  apiRouter,
  mountBeforeBodyParser: (express) => mountAuth(express, auth, securityEvents),
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "backend escuchando");
});

const shutdown = createShutdown({ server, closers, logger });
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0));
  });
}

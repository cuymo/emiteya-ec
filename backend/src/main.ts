// Arranque y apagado del backend. Desarrollo: node --conditions=development src/main.ts (ADR 0016).
import { randomUUID } from "node:crypto";
import { createApp } from "./app.ts";
import { EnvError, loadEnv, loadInitialAdmin, type Env } from "./config/env.ts";
import { provisionInstallation } from "./modules/identity/application/provisioning.ts";
import {
  authSettingsFromEnv,
  createAuth,
  createUnitOfWork,
  mountAuth,
} from "./modules/identity/infrastructure/better-auth/index.ts";
import { createCompanyReader } from "./modules/identity/infrastructure/prisma-companies.ts";
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

const authSettings = authSettingsFromEnv(env);
const auth = createAuth({ prisma: database.prisma, settings: authSettings });

// Aprovisionamiento antes de aceptar tráfico (design D7).
try {
  const result = await provisionInstallation({
    uow: createUnitOfWork(database.prisma, auth, authSettings),
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

const app = createApp({
  logger,
  metrics: createMetrics(),
  readiness: () => database.ping(),
  trustProxy: env.TRUST_PROXY,
  mountBeforeBodyParser: (express) => mountAuth(express, auth),
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

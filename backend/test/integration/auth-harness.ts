// Arnés de las pruebas de autenticación: la aplicación real con Better Auth montado sobre un
// esquema aislado. Usa solo la superficie pública del módulo de integración (design D2b).
import { Router, type RequestHandler } from "express";
import { userSchemas } from "@facturador/contracts";
import request from "supertest";
import { createApp } from "../../src/app.ts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import type { MembershipReader } from "../../src/modules/identity/application/memberships.ts";
import { createUserAdministration } from "../../src/modules/identity/application/user-administration.ts";
import type {
  SecurityEvent,
  SecurityEventSink,
} from "../../src/modules/identity/application/security-events.ts";
import type { UnitOfWork } from "../../src/modules/identity/application/unit-of-work.ts";
import type { Role } from "../../src/modules/identity/domain/roles.ts";
import {
  createAuth,
  createUnitOfWork,
  getSessionUserId,
  mountAuth,
  type Auth,
  type AuthSettings,
} from "../../src/modules/identity/infrastructure/better-auth/index.ts";
import { requireContext } from "../../src/modules/identity/infrastructure/http/request-context.ts";
import { usersRouter } from "../../src/modules/identity/infrastructure/http/users-router.ts";
import { createMembershipReader } from "../../src/modules/identity/infrastructure/prisma-memberships.ts";
import { createSecurityEventLog } from "../../src/modules/identity/infrastructure/security-event-log.ts";
import { createLogger } from "../../src/platform/logging/logger.ts";
import { createMetrics } from "../../src/platform/metrics/metrics.ts";
import type { MigratedSchema } from "./database.ts";

export const BASE_URL = "http://localhost:3000";
export const PASSWORD = "contrasena-de-prueba-1";

export function testAuthSettings(overrides: Partial<AuthSettings> = {}): AuthSettings {
  return {
    secret: "secreto-de-pruebas-0123456789abcdef0123456789",
    baseURL: BASE_URL,
    secureCookies: false,
    password: { minLength: 12, maxLength: 128 },
    loginFailures: { max: 5, windowMs: 15 * 60_000 },
    ipRateLimit: { max: 30, windowSeconds: 60 },
    ...overrides,
  };
}

export type AuthApp = ReturnType<typeof buildAuthApp>;

export type ApiDependencies = {
  auth: Auth;
  uow: UnitOfWork;
  securityEvents: SecurityEventSink;
  memberships: MembershipReader;
  /** Middleware real de design D3 con la sesión de este arnés. */
  context: RequestHandler;
};

export function buildAuthApp(
  db: MigratedSchema,
  options: {
    settings?: Partial<AuthSettings>;
    trustProxy?: number | false;
    apiRouter?: (deps: ApiDependencies) => Router;
  } = {},
) {
  const settings = testAuthSettings(options.settings);
  const lines: string[] = [];
  const logger = createLogger("info", { write: (line: string) => void lines.push(line) });
  const metrics = createMetrics();
  const events: SecurityEvent[] = [];
  const securityLog = createSecurityEventLog(logger, metrics.registry);
  const securityEvents: SecurityEventSink = {
    emit: (event) => {
      events.push(event);
      securityLog.emit(event);
    },
  };
  const auth = createAuth({ prisma: db.database.prisma, settings, securityEvents });
  const uow = createUnitOfWork(db.database.prisma, auth, settings);
  const memberships = createMembershipReader(db.database.prisma);
  const context = requireContext({
    getSessionUserId: (headers) => getSessionUserId(auth, headers),
    memberships,
  });
  const app = createApp({
    logger,
    metrics,
    readiness: () => Promise.resolve(true),
    trustProxy: options.trustProxy ?? false,
    mountBeforeBodyParser: (express) => mountAuth(express, auth, securityEvents),
    ...(options.apiRouter
      ? { apiRouter: options.apiRouter({ auth, uow, securityEvents, memberships, context }) }
      : {}),
  });
  return { app, auth, uow, settings, events, metrics, logs: () => lines.join("") };
}

/** Crea identidad y membresía por el camino de producción (Better Auth en la unidad de trabajo). */
export async function createMember(
  uow: UnitOfWork,
  companyId: string,
  member: { name: string; email: string; role?: Role; password?: string },
): Promise<string> {
  return uow.run(async ({ identity }) => {
    const userId = await identity.createUser({
      name: member.name,
      email: member.email,
      password: member.password ?? PASSWORD,
    });
    await identity.addMembership({ companyId, userId, role: member.role ?? "OPERATOR" });
    return userId;
  });
}

export async function signIn(
  app: AuthApp["app"],
  email: string,
  password: string,
  headers: Record<string, string> = {},
) {
  const res = await request(app)
    .post("/api/auth/sign-in/email")
    .set("Origin", BASE_URL)
    .set(headers)
    .send({ email, password });
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = setCookie?.map((c) => c.split(";")[0]).join("; ") ?? "";
  return { status: res.status, body: res.body as { code?: string; message?: string }, cookie };
}

/** Espera a que se cumpla una condición asíncrona, como un evento emitido fuera de la respuesta. */
export async function eventually(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("La condición no se cumplió a tiempo");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** La API de usuarios montada como en main.ts; `wrapUow` permite inyectar fallos en la transacción. */
export function buildUsersApp(
  db: MigratedSchema,
  options: Omit<Parameters<typeof buildAuthApp>[1] & object, "apiRouter"> & {
    wrapUow?: (uow: UnitOfWork) => UnitOfWork;
  } = {},
) {
  const { wrapUow, ...rest } = options;
  return buildAuthApp(db, {
    ...rest,
    apiRouter: ({ context, uow, memberships, securityEvents }) =>
      Router()
        .use(context)
        .use(
          usersRouter(
            createUserAdministration({
              uow: wrapUow ? wrapUow(uow) : uow,
              memberships,
              authorizer: createAuthorizer({ memberships, securityEvents }),
              schemas: userSchemas(testAuthSettings(rest.settings).password),
            }),
          ),
        ),
  });
}

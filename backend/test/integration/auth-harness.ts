// Arnés de las pruebas de autenticación: la aplicación real con Better Auth montado sobre un
// esquema aislado. Usa solo la superficie pública del módulo de integración (design D2b).
import type { Router } from "express";
import request from "supertest";
import { createApp } from "../../src/app.ts";
import type { SecurityEvent } from "../../src/modules/identity/application/security-events.ts";
import type { UnitOfWork } from "../../src/modules/identity/application/unit-of-work.ts";
import type { Role } from "../../src/modules/identity/domain/roles.ts";
import {
  createAuth,
  createUnitOfWork,
  mountAuth,
  type AuthSettings,
} from "../../src/modules/identity/infrastructure/better-auth/index.ts";
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

export function buildAuthApp(
  db: MigratedSchema,
  options: {
    settings?: Partial<AuthSettings>;
    trustProxy?: number | false;
    apiRouter?: Router;
  } = {},
) {
  const settings = testAuthSettings(options.settings);
  const events: SecurityEvent[] = [];
  const securityEvents = { emit: (event: SecurityEvent) => void events.push(event) };
  const auth = createAuth({ prisma: db.database.prisma, settings, securityEvents });
  const uow = createUnitOfWork(db.database.prisma, auth, settings);
  const lines: string[] = [];
  const app = createApp({
    logger: createLogger("info", { write: (line: string) => void lines.push(line) }),
    metrics: createMetrics(),
    readiness: () => Promise.resolve(true),
    trustProxy: options.trustProxy ?? false,
    mountBeforeBodyParser: (express) => mountAuth(express, auth, securityEvents),
    ...(options.apiRouter ? { apiRouter: options.apiRouter } : {}),
  });
  return { app, auth, uow, settings, events, logs: () => lines.join("") };
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

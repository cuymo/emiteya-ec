// Better Auth configurado según design D2, D6 y D9. Todo uso de Better Auth vive en este módulo (D2b).
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { PrismaClient } from "../../../../generated/prisma/client.ts";
import {
  NO_SECURITY_EVENTS,
  type SecurityEventSink,
  type SignInFailureReason,
} from "../../application/security-events.ts";
import { can } from "../../domain/access-policy.ts";
import { LoginThrottle } from "./login-throttle.ts";
import { createAdminPlugin, createOrganizationPlugin } from "./plugins.ts";
import { CLIENT_IP_HEADER, REQUEST_ID_HEADER } from "./server-headers.ts";

export const AUTH_BASE_PATH = "/api/auth";
const SIGN_IN_PATH = "/sign-in/email";
const CHANGE_PASSWORD_PATH = "/change-password";

/**
 * Superficie HTTP de Better Auth (design D2): denegada por defecto. Solo las operaciones que usan
 * las specs actuales. La cuenta y la sesión actuales se leen con GET /api/v1/me, que el servidor
 * resuelve con auth.api.getSession, y la administración corre en el servidor (auth.api y
 * auth.$context). Un endpoint que traiga una versión futura queda cerrado hasta añadirlo aquí.
 */
export const CLIENT_ENDPOINTS = [
  { method: "POST", path: SIGN_IN_PATH, purpose: "Iniciar sesión" },
  { method: "POST", path: "/sign-out", purpose: "Cerrar sesión" },
  { method: "POST", path: CHANGE_PASSWORD_PATH, purpose: "Cambiar la contraseña propia" },
] as const;

export function isClientEndpoint(method: string, path: string): boolean {
  return CLIENT_ENDPOINTS.some((endpoint) => endpoint.method === method && endpoint.path === path);
}
/** Mismo código y mensaje que una contraseña incorrecta: no revela la desactivación (D6). */
const INVALID_CREDENTIALS = {
  code: "INVALID_EMAIL_OR_PASSWORD",
  message: "Invalid email or password",
};

export type AuthSettings = Readonly<{
  secret: string;
  baseURL: string;
  secureCookies: boolean;
  password: Readonly<{ minLength: number; maxLength: number }>;
  loginFailures: Readonly<{ max: number; windowMs: number }>;
  ipRateLimit: Readonly<{ max: number; windowSeconds: number }>;
}>;

export type AuthDependencies = {
  prisma: PrismaClient;
  settings: AuthSettings;
  securityEvents?: SecurityEventSink;
  now?: () => number;
};

/** Correo del cuerpo de /sign-in/email, normalizado como lo guarda Better Auth. */
function bodyEmail(body: unknown): string {
  const email = (body as { email?: unknown } | null | undefined)?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export function createAuth({
  prisma,
  settings,
  securityEvents = NO_SECURITY_EVENTS,
  now = Date.now,
}: AuthDependencies) {
  const throttle = new LoginThrottle(settings.loginFailures, now);

  /** Categoría interna del fallo, calculada fuera del camino de la respuesta para no variar su tiempo. */
  async function failureReason(email: string): Promise<SignInFailureReason> {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return "unknown_account";
    const active = await prisma.member.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      select: { id: true },
    });
    return active ? "invalid_credentials" : "inactive_membership";
  }

  /** Membresía activa con permiso para la contraseña propia: es una operación protegida (D3, D4). */
  async function passwordChangeMembership(userId: string) {
    const membership = await prisma.member.findFirst({
      where: { userId, status: "ACTIVE" },
      select: { organizationId: true, role: true },
    });
    return membership && can(membership.role, "account.changePassword") ? membership : null;
  }

  function reportFailure(email: string, ip: string | null, correlationId: string | null) {
    setImmediate(() => {
      failureReason(email)
        .catch((): SignInFailureReason => "unknown")
        .then((reason) =>
          securityEvents.emit({ type: "sign_in_failed", reason, ip, correlationId }),
        )
        .catch(() => {});
    });
  }

  return betterAuth({
    appName: "Facturador",
    baseURL: settings.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: settings.secret,
    telemetry: { enabled: false },
    database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: settings.password.minLength,
      maxPasswordLength: settings.password.maxLength,
    },
    // Sesiones en base de datos sin caché en cookie: la revocación rige en la siguiente petición.
    session: { cookieCache: { enabled: false } },
    // Capa 2 del límite (D9): por IP, en memoria, solo contra ráfagas.
    rateLimit: {
      enabled: true,
      storage: "memory",
      customRules: {
        [SIGN_IN_PATH]: {
          window: settings.ipRateLimit.windowSeconds,
          max: settings.ipRateLimit.max,
        },
      },
    },
    advanced: {
      useSecureCookies: settings.secureCookies,
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    hooks: {
      // Better Auth espera una promesa y trata una excepción como respuesta de error.
      before: createAuthMiddleware(async (ctx) => {
        // Allowlist (D2): toda petición HTTP a un endpoint fuera de la lista responde 404. Las
        // llamadas de servidor (auth.api.*) no son peticiones HTTP y no se ven afectadas.
        if (ctx.request && !isClientEndpoint(ctx.request.method, ctx.path)) {
          throw new APIError("NOT_FOUND");
        }
        if (ctx.path === CHANGE_PASSWORD_PATH) {
          const session = await getSessionFromCtx(ctx);
          if (session && !(await passwordChangeMembership(session.user.id))) {
            throw new APIError("UNAUTHORIZED", {
              code: "UNAUTHENTICATED",
              message: "Unauthorized",
            });
          }
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          // Las demás sesiones se invalidan siempre (D6), aunque el cliente envíe otro valor.
          return { context: { body: { ...body, revokeOtherSessions: true } } };
        }
        if (ctx.path !== SIGN_IN_PATH) return;
        const key = `${bodyEmail(ctx.body)}|${ctx.headers?.get(CLIENT_IP_HEADER) ?? ""}`;
        // Capa 1 del límite (D9): por correo e IP, incluso con la contraseña correcta.
        if (throttle.isBlocked(key)) {
          throw new APIError("TOO_MANY_REQUESTS", {
            code: "TOO_MANY_ATTEMPTS",
            message: "Too many attempts, try again later",
          });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === CHANGE_PASSWORD_PATH && !(ctx.context.returned instanceof APIError)) {
          const returned = ctx.context.returned as { user?: { id?: string } } | undefined;
          const userId = ctx.context.session?.user.id ?? returned?.user?.id;
          const membership = userId ? await passwordChangeMembership(userId) : null;
          if (userId && membership) {
            securityEvents.emit({
              type: "own_password_changed",
              actorUserId: userId,
              companyId: membership.organizationId,
              correlationId: ctx.headers?.get(REQUEST_ID_HEADER) ?? null,
            });
          }
          return;
        }
        if (ctx.path !== SIGN_IN_PATH) return;
        const email = bodyEmail(ctx.body);
        const ip = ctx.headers?.get(CLIENT_IP_HEADER) || null;
        const key = `${email}|${ip ?? ""}`;
        const returned = ctx.context.returned;
        if (returned instanceof APIError) {
          if (returned.status === "TOO_MANY_REQUESTS") return;
          throttle.recordFailure(key);
          reportFailure(email, ip, ctx.headers?.get(REQUEST_ID_HEADER) ?? null);
        } else {
          throttle.reset(key);
        }
      }),
    },
    plugins: [createAdminPlugin(), createOrganizationPlugin()],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            // Sin membresía activa no se abre sesión (D6), con el error de una contraseña incorrecta.
            const active = await prisma.member.findFirst({
              where: { userId: session.userId, status: "ACTIVE" },
              select: { id: true },
            });
            if (!active) throw new APIError("UNAUTHORIZED", INVALID_CREDENTIALS);
            // La IP no se persiste: solo vive en memoria para el límite de intentos (D9).
            return { data: { ...session, ipAddress: null } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

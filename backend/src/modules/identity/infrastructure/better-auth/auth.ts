// Better Auth configurado según design D2, D6 y D9. Todo uso de Better Auth vive en este módulo (D2b).
import { passwordSchema } from "@facturador/contracts";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { PrismaClient } from "../../../../generated/prisma/client.ts";
import {
  PASSWORD_RESET_MINUTES,
  type PasswordResetMailer,
} from "../../application/password-reset.ts";
import {
  NO_SECURITY_EVENTS,
  type PasswordResetOutcome,
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
const REQUEST_RESET_PATH = "/request-password-reset";
const RESET_PASSWORD_PATH = "/reset-password";

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
  // add-password-reset-by-email, design D1. `GET /reset-password/:token`, que redirige con el
  // token en la consulta, sigue cerrado: el enlace va al frontend con el token en el fragmento.
  { method: "POST", path: REQUEST_RESET_PATH, purpose: "Pedir el enlace de recuperación" },
  {
    method: "POST",
    path: RESET_PASSWORD_PATH,
    purpose: "Poner una contraseña nueva con el enlace",
  },
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

/** Solicitudes del enlace por correo e IP (design D4): como mucho 3 cada 15 minutos. */
export const PASSWORD_RESET_REQUESTS = { max: 3, windowMs: 15 * 60_000 } as const;
/** Límite por IP de los dos endpoints de la recuperación (design D4). */
const PASSWORD_RESET_IP_LIMIT = { window: 15 * 60, max: 10 } as const;

/** La recuperación por correo: sin ella, los endpoints responden que no está disponible. */
export type PasswordResetSettings = Readonly<{
  mailer: PasswordResetMailer;
  /** Origen público del frontend, donde vive `/restablecer-contrasena`. */
  publicOrigin: string;
}>;

export type AuthDependencies = {
  prisma: PrismaClient;
  settings: AuthSettings;
  securityEvents?: SecurityEventSink;
  passwordReset?: PasswordResetSettings;
  now?: () => number;
};

/** Correo del cuerpo de /sign-in/email, normalizado como lo guarda Better Auth. */
function bodyEmail(body: unknown): string {
  const email = (body as { email?: unknown } | null | undefined)?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** Enlace de la pantalla de la contraseña nueva, con el token en el fragmento (design D2). */
export function passwordResetLink(publicOrigin: string, token: string): string {
  return `${new URL(publicOrigin).origin}/restablecer-contrasena#token=${encodeURIComponent(token)}`;
}

export function createAuth({
  prisma,
  settings,
  securityEvents = NO_SECURITY_EVENTS,
  passwordReset,
  now = Date.now,
}: AuthDependencies) {
  const throttle = new LoginThrottle(settings.loginFailures, now);
  const resetThrottle = new LoginThrottle(PASSWORD_RESET_REQUESTS, now);

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

  /** Las empresas de las membresías activas, de la más antigua a la más nueva (design D3). */
  async function activeCompanies(userId: string): Promise<string[]> {
    const members = await prisma.member.findMany({
      where: { userId, status: "ACTIVE" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { organizationId: true },
    });
    return members.map((member) => member.organizationId);
  }

  function reportReset(
    outcome: PasswordResetOutcome,
    ip: string | null,
    correlationId: string | null,
  ) {
    securityEvents.emit({ type: "password_reset_requested", outcome, ip, correlationId });
  }

  /**
   * Envía el enlace en segundo plano (design D3): la respuesta sale enseguida y su tiempo no depende
   * de la cuenta, del servidor de correo ni del resultado. Un fallo solo queda en el evento.
   */
  function sendResetLink(
    user: { id: string; email: string },
    token: string,
    request: Request | undefined,
  ) {
    const ip = request?.headers.get(CLIENT_IP_HEADER) || null;
    const correlationId = request?.headers.get(REQUEST_ID_HEADER) ?? null;
    const key = `${user.email.trim().toLowerCase()}|${ip ?? ""}`;
    if (resetThrottle.isBlocked(key)) return reportReset("throttled", ip, correlationId);
    resetThrottle.recordFailure(key);
    if (!passwordReset) return;
    const { mailer, publicOrigin } = passwordReset;
    setImmediate(() => {
      activeCompanies(user.id)
        .then(async (companyIds): Promise<PasswordResetOutcome> => {
          if (companyIds.length === 0) return "inactive_membership";
          return mailer.send({
            to: user.email,
            companyIds,
            link: passwordResetLink(publicOrigin, token),
            expiresInMinutes: PASSWORD_RESET_MINUTES,
          });
        })
        .catch((): PasswordResetOutcome => "send_failed")
        .then((outcome) => reportReset(outcome, ip, correlationId))
        .catch(() => {});
    });
  }

  /** Una solicitud para un correo sin cuenta solo deja su evento, fuera del camino de la respuesta. */
  function reportUnknownReset(email: string, ip: string | null, correlationId: string | null) {
    setImmediate(() => {
      prisma.user
        .findUnique({ where: { email }, select: { id: true } })
        .then((user) => {
          if (!user) reportReset("no_account", ip, correlationId);
        })
        .catch(() => {});
    });
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
      // add-password-reset-by-email, design D1.
      resetPasswordTokenExpiresIn: PASSWORD_RESET_MINUTES * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }, request) => {
        sendResetLink(user, token, request);
        return Promise.resolve();
      },
      onPasswordReset: async ({ user }, request) => {
        const companyIds = await activeCompanies(user.id);
        securityEvents.emit({
          type: "password_reset_completed",
          actorUserId: user.id,
          companyId: companyIds[0] ?? null,
          correlationId: request?.headers.get(REQUEST_ID_HEADER) ?? null,
        });
      },
    },
    // El token del enlace se guarda con hash: la tabla `verification` nunca lo tiene en claro (D1).
    verification: { storeIdentifier: "hashed" },
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
        [REQUEST_RESET_PATH]: PASSWORD_RESET_IP_LIMIT,
        [RESET_PASSWORD_PATH]: PASSWORD_RESET_IP_LIMIT,
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
        if (ctx.path === RESET_PASSWORD_PATH) {
          // La contraseña nueva cumple la misma política que el cambio de la propia (design D4).
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const policy = passwordSchema(settings.password).safeParse(body.newPassword);
          if (typeof body.newPassword === "string" && !policy.success) {
            throw new APIError("BAD_REQUEST", {
              code: "PASSWORD_POLICY",
              message: policy.error.issues[0]?.message ?? "La contraseña no es válida.",
            });
          }
          return;
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
          // Política de contraseñas con el valor vigente en el mensaje (spec: "indicando la longitud
          // mínima vigente"); la interfaz no fija los valores, que son configuración.
          const policy = passwordSchema(settings.password).safeParse(body.newPassword);
          if (typeof body.newPassword === "string" && !policy.success) {
            throw new APIError("BAD_REQUEST", {
              code: "PASSWORD_POLICY",
              message: policy.error.issues[0]?.message ?? "La contraseña no es válida.",
            });
          }
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
        if (ctx.path === REQUEST_RESET_PATH) {
          reportUnknownReset(
            bodyEmail(ctx.body),
            ctx.headers?.get(CLIENT_IP_HEADER) || null,
            ctx.headers?.get(REQUEST_ID_HEADER) ?? null,
          );
          return;
        }
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

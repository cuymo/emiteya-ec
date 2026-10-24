// Superficie pública del módulo de integración con Better Auth (design D2b). El resto de la
// aplicación usa estas funciones y los puertos de identity/application; nunca Better Auth.
import { passwordPolicy, type Env } from "../../../../config/env.ts";
import type { AuthSettings } from "./auth.ts";

export {
  AUTH_BASE_PATH,
  CLIENT_ENDPOINTS,
  createAuth,
  isClientEndpoint,
  passwordResetLink,
  PASSWORD_RESET_REQUESTS,
  type Auth,
  type AuthSettings,
  type PasswordResetSettings,
} from "./auth.ts";
export { getSessionUserId, mountAuth } from "./http.ts";
export { createUnitOfWork, type CompanyInitializer } from "./unit-of-work.ts";

export function authSettingsFromEnv(env: Env): AuthSettings {
  return {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // Cookies Secure en producción (D2).
    secureCookies: env.NODE_ENV === "production",
    password: passwordPolicy(env),
    loginFailures: {
      max: env.LOGIN_MAX_FAILURES,
      windowMs: env.LOGIN_FAILURE_WINDOW_MINUTES * 60_000,
    },
    ipRateLimit: { max: env.LOGIN_IP_MAX_REQUESTS, windowSeconds: env.LOGIN_IP_WINDOW_SECONDS },
  };
}

// Llamadas a los endpoints de Better Auth en /api/auth (ADR 0015). El frontend no maneja
// credenciales ni sesiones por su cuenta: solo envía el formulario y traduce el resultado.

export type AuthErrorKind =
  | "invalid_credentials"
  | "rate_limited"
  | "invalid_current_password"
  | "password_policy"
  | "invalid_token"
  | "unauthenticated"
  | "unexpected";

export class AuthError extends Error {
  readonly kind: AuthErrorKind;

  constructor(kind: AuthErrorKind, message: string) {
    super(message);
    this.name = "AuthError";
    this.kind = kind;
  }
}

const MESSAGES: Record<AuthErrorKind, string> = {
  invalid_credentials: "El correo o la contraseña no son correctos.",
  rate_limited: "Demasiados intentos. Espera unos minutos e intenta de nuevo.",
  invalid_current_password: "La contraseña actual no es correcta.",
  password_policy: "La contraseña nueva no cumple la longitud permitida.",
  invalid_token: "El enlace ya no sirve: venció o ya se usó. Pide otro.",
  unauthenticated: "Tu sesión terminó. Inicia sesión de nuevo.",
  unexpected: "No pudimos completar la operación. Intenta de nuevo.",
};

async function authPost(path: string, body: unknown): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("unexpected", "No pudimos conectar con el servidor. Revisa tu conexión.");
  }
  if (response.ok) return;
  const payload = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
  const kind = classify(response.status, payload.code);
  // La política de contraseñas la comunica el servidor con el valor vigente.
  const message =
    payload.code === "PASSWORD_POLICY" && payload.message ? payload.message : MESSAGES[kind];
  throw new AuthError(kind, message);
}

function classify(status: number, code: string | undefined): AuthErrorKind {
  if (status === 429) return "rate_limited";
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "invalid_credentials";
  if (code === "INVALID_PASSWORD") return "invalid_current_password";
  if (code === "PASSWORD_POLICY" || code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
    return "password_policy";
  }
  if (code === "INVALID_TOKEN") return "invalid_token";
  if (status === 401) return "unauthenticated";
  return "unexpected";
}

export function signIn(email: string, password: string): Promise<void> {
  return authPost("/sign-in/email", { email, password });
}

export function signOut(): Promise<void> {
  return authPost("/sign-out", {});
}

/** El servidor invalida siempre las demás sesiones (design D6). */
export function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  return authPost("/change-password", { currentPassword, newPassword, revokeOtherSessions: true });
}

/**
 * Pide el enlace de recuperación (add-password-reset-by-email). El servidor responde lo mismo exista
 * o no la cuenta; solo un error de red o el límite de intentos llegan como error.
 */
export function requestPasswordReset(email: string): Promise<void> {
  return authPost("/request-password-reset", { email });
}

/** Pone la contraseña nueva con el token del enlace; el servidor cierra todas las sesiones. */
export function resetPassword(token: string, newPassword: string): Promise<void> {
  return authPost("/reset-password", { token, newPassword });
}

/** Ruta interna segura para volver tras iniciar sesión; evita redirecciones a otros orígenes. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return "/";
  if (value.startsWith("/iniciar-sesion")) return "/";
  return value;
}

// Eventos de seguridad (design D13): logs estructurados y métricas, no auditoría. Pueden no tener
// empresa y nunca llevan contraseñas, tokens, cookies ni el correo en claro.
import type { OriginRejection } from "../../../platform/http/request-origin.ts";

export type SignInFailureReason =
  "unknown_account" | "invalid_credentials" | "inactive_membership" | "unknown";

/** Resultado de una solicitud del enlace de recuperación (add-password-reset-by-email, D5). */
export type PasswordResetOutcome =
  "sent" | "no_account" | "inactive_membership" | "no_mail_server" | "send_failed" | "throttled";

export type SecurityEvent =
  | {
      type: "sign_in_failed";
      reason: SignInFailureReason;
      ip: string | null;
      correlationId: string | null;
    }
  | { type: "rate_limited"; path: string; ip: string | null; correlationId: string | null }
  | {
      type: "authorization_denied";
      actorUserId: string;
      companyId: string;
      action: string;
      status: 403 | 404;
      correlationId: string;
    }
  | {
      type: "own_password_changed";
      actorUserId: string;
      companyId: string;
      correlationId: string | null;
    }
  | {
      type: "password_reset_requested";
      outcome: PasswordResetOutcome;
      ip: string | null;
      correlationId: string | null;
    }
  | {
      type: "password_reset_completed";
      actorUserId: string;
      companyId: string | null;
      correlationId: string | null;
    }
  | ({ type: "request_origin_rejected" } & OriginRejection);

export interface SecurityEventSink {
  emit(event: SecurityEvent): void;
}

export const NO_SECURITY_EVENTS: SecurityEventSink = { emit: () => {} };

// Eventos de seguridad (design D13): logs estructurados y métricas, no auditoría. Pueden no tener
// empresa y nunca llevan contraseñas, tokens, cookies ni el correo en claro.
import type { OriginRejection } from "../../../platform/http/request-origin.ts";

export type SignInFailureReason =
  "unknown_account" | "invalid_credentials" | "inactive_membership" | "unknown";

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
  | ({ type: "request_origin_rejected" } & OriginRejection);

export interface SecurityEventSink {
  emit(event: SecurityEvent): void;
}

export const NO_SECURITY_EVENTS: SecurityEventSink = { emit: () => {} };

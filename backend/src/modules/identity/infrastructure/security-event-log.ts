// Eventos de seguridad como logs estructurados y métricas (design D13). No se guardan en la base de
// datos ni en la auditoría. Los eventos no llevan correo, contraseñas, tokens ni cookies por
// construcción; la redacción del logger es una segunda defensa.
import { Counter, type Registry } from "@prometheus-io/client";
import type { Logger } from "pino";
import type { SecurityEvent, SecurityEventSink } from "../application/security-events.ts";

export function createSecurityEventLog(logger: Logger, registry: Registry): SecurityEventSink {
  const signInFailures = new Counter({
    name: "auth_sign_in_failures_total",
    help: "Inicios de sesión fallidos por categoría interna.",
    labelNames: ["reason"] as const,
    registers: [registry],
  });
  const rateLimited = new Counter({
    name: "auth_rate_limited_total",
    help: "Respuestas 429 del límite de intentos de autenticación.",
    registers: [registry],
  });
  const denials = new Counter({
    name: "authorization_denials_total",
    help: "Denegaciones de autorización por estado y acción.",
    labelNames: ["status", "action"] as const,
    registers: [registry],
  });
  const log = logger.child({ channel: "security" });

  return {
    emit(event: SecurityEvent) {
      switch (event.type) {
        case "sign_in_failed":
          signInFailures.inc({ reason: event.reason });
          log.warn(
            {
              event: event.type,
              reason: event.reason,
              ip: event.ip,
              requestId: event.correlationId,
            },
            "inicio de sesión fallido",
          );
          return;
        case "rate_limited":
          rateLimited.inc();
          log.warn(
            { event: event.type, path: event.path, ip: event.ip, requestId: event.correlationId },
            "límite de intentos alcanzado",
          );
          return;
        case "authorization_denied":
          denials.inc({ status: String(event.status), action: event.action });
          log.warn(
            {
              event: event.type,
              status: event.status,
              action: event.action,
              actorUserId: event.actorUserId,
              companyId: event.companyId,
              requestId: event.correlationId,
            },
            "autorización denegada",
          );
          return;
        case "own_password_changed":
          log.info(
            {
              event: event.type,
              actorUserId: event.actorUserId,
              companyId: event.companyId,
              requestId: event.correlationId,
            },
            "contraseña propia cambiada",
          );
          return;
      }
    },
  };
}

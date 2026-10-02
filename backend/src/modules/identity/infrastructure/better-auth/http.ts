// Montaje del handler de Better Auth en Express y lectura de la sesión de una petición (design D2 y D3).
import type { IncomingHttpHeaders } from "node:http";
import type { Express, RequestHandler } from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { NO_SECURITY_EVENTS, type SecurityEventSink } from "../../application/security-events.ts";
import { AUTH_BASE_PATH, type Auth } from "./auth.ts";
import { serverHeaders } from "./server-headers.ts";

/** Registra cada respuesta 429 de Better Auth como evento de seguridad (D13). */
function reportRateLimits(securityEvents: SecurityEventSink): RequestHandler {
  return (req, res, next) => {
    res.on("finish", () => {
      if (res.statusCode !== 429) return;
      securityEvents.emit({
        type: "rate_limited",
        path: req.path,
        ip: req.ip ?? null,
        correlationId: req.requestId,
      });
    });
    next();
  };
}

/** Monta Better Auth en /api/auth/* antes de express.json(), que no debe consumir su cuerpo. */
export function mountAuth(
  app: Express,
  auth: Auth,
  securityEvents: SecurityEventSink = NO_SECURITY_EVENTS,
): void {
  app.all(
    `${AUTH_BASE_PATH}/{*any}`,
    serverHeaders,
    reportRateLimits(securityEvents),
    toNodeHandler(auth),
  );
}

/** El usuario de la sesión de la petición, o null si no hay sesión válida. */
export async function getSessionUserId(
  auth: Auth,
  headers: IncomingHttpHeaders,
): Promise<string | null> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  return session?.user.id ?? null;
}

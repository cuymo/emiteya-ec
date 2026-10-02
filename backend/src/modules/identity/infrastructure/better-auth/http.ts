// Montaje del handler de Better Auth en Express y lectura de la sesión de una petición (design D2 y D3).
import type { IncomingHttpHeaders } from "node:http";
import type { Express, RequestHandler } from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { NO_SECURITY_EVENTS, type SecurityEventSink } from "../../application/security-events.ts";
import { AUTH_BASE_PATH, isClientEndpoint, type Auth } from "./auth.ts";
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

/**
 * Primera capa de la allowlist (D2): solo un método y una ruta exactos de CLIENT_ENDPOINTS llegan a
 * Better Auth; cualquier otra petición, incluidas variantes de la ruta, sigue hacia el 404 de la
 * aplicación. El hook de Better Auth vuelve a comprobarlo sobre el endpoint resuelto.
 */
const allowClientEndpoints: RequestHandler = (req, _res, next) => {
  next(isClientEndpoint(req.method, req.path.slice(AUTH_BASE_PATH.length)) ? undefined : "route");
};

/** Monta Better Auth en /api/auth/* antes de express.json(), que no debe consumir su cuerpo. */
export function mountAuth(
  app: Express,
  auth: Auth,
  securityEvents: SecurityEventSink = NO_SECURITY_EVENTS,
): void {
  app.all(
    `${AUTH_BASE_PATH}/{*any}`,
    allowClientEndpoints,
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

// Montaje del handler de Better Auth en Express y lectura de la sesión de una petición (design D2 y D3).
import type { IncomingHttpHeaders } from "node:http";
import express, {
  type Express,
  type Request as ExpressRequest,
  type RequestHandler,
  type Response as ExpressResponse,
} from "express";
import { fromNodeHeaders } from "better-auth/node";
import { AppError } from "../../../../platform/http/errors.ts";
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

/** Cuerpo máximo de /api/auth/* (enforce-api-origin-and-body-limits, design D6). */
export const AUTH_BODY_LIMIT_BYTES = 8192;

/**
 * Cabeceras de un salto, y las del encuadre y la codificación de un cuerpo que ya se leyó y se
 * descomprimió: no llegan a Better Auth.
 */
const DROPPED_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "content-length",
  "content-encoding",
]);

/**
 * Lo que se decide con las cabeceras, sin leer el cuerpo: un cuerpo no vacío tiene que ser JSON, y
 * un `Content-Length` mayor que el límite se rechaza de inmediato. El parser de Express, en cambio,
 * descarta el cuerpo entero antes de informar el exceso.
 */
const checkDeclaredBody: RequestHandler = (req, _res, next) => {
  const length = Number(req.headers["content-length"] ?? 0);
  const declaresBody = req.headers["transfer-encoding"] !== undefined || length > 0;
  if (declaresBody && !req.is("application/json")) {
    next(
      new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        415,
        "El tipo de contenido de la solicitud no es compatible.",
      ),
    );
    return;
  }
  next(
    length > AUTH_BODY_LIMIT_BYTES
      ? new AppError("PAYLOAD_TOO_LARGE", 413, "El cuerpo de la solicitud es demasiado grande.")
      : undefined,
  );
};

/**
 * La petición web que recibe Better Auth: el origen canónico con la ruta y la consulta reales, nunca
 * Host ni X-Forwarded-*, y el cuerpo ya leído.
 */
export function toAuthRequest(req: ExpressRequest, origin: string): Request {
  const connectionNamed = new Set(
    String(req.headers.connection ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || DROPPED_HEADERS.has(name) || connectionNamed.has(name)) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  const body: unknown = req.body;
  const hasBody =
    req.method !== "GET" && req.method !== "HEAD" && Buffer.isBuffer(body) && body.length > 0;
  return new Request(`${origin}${req.originalUrl}`, {
    method: req.method,
    headers,
    ...(hasBody ? { body } : {}),
  });
}

/** Escribe la respuesta de Better Auth, con cada `Set-Cookie` por separado. */
export async function writeAuthResponse(res: ExpressResponse, response: Response): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  res.status(response.status);
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
  res.end(body);
}

/**
 * Adaptador acotado en lugar de `toNodeHandler` (design D6): 415 si el cuerpo declarado no es JSON,
 * 413 si su `Content-Length` supera `AUTH_BODY_LIMIT_BYTES`, lectura que cuenta los bytes recibidos
 * (413 al superarlo, también en `chunked`) y la petición web para Better Auth. Un corte o un error
 * de la lectura no llega al manejador.
 */
export function boundedAuthHandler(
  handler: (request: Request) => Promise<Response>,
  origin: string,
): RequestHandler[] {
  return [
    checkDeclaredBody,
    express.raw({ type: "application/json", limit: AUTH_BODY_LIMIT_BYTES }),
    async (req, res) => {
      await writeAuthResponse(res, await handler(toAuthRequest(req, origin)));
    },
  ];
}

/** Monta Better Auth en /api/auth/* antes de express.json(), que no debe consumir su cuerpo. */
export function mountAuth(
  app: Express,
  auth: Auth,
  options: { origin: string; securityEvents?: SecurityEventSink },
): void {
  app.all(
    `${AUTH_BASE_PATH}/{*any}`,
    allowClientEndpoints,
    serverHeaders,
    reportRateLimits(options.securityEvents ?? NO_SECURITY_EVENTS),
    ...boundedAuthHandler((request) => auth.handler(request), options.origin),
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

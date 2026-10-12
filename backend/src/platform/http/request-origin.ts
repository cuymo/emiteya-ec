// Origen y Fetch Metadata de /api/v1 (enforce-api-origin-and-body-limits, design D1 a D4 y D8). La
// única fuente de confianza es el origen canónico; Host y las cabeceras reenviadas no intervienen.
import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import { AppError } from "./errors.ts";

export type OriginRejectionReason =
  | "missing_origin"
  | "null_origin"
  | "malformed_origin"
  | "origin_mismatch"
  | "fetch_site_same_site"
  | "fetch_site_cross_site";

/** Lo que se registra de un rechazo: nunca la URL, el `Origin` recibido ni otras cabeceras. */
export type OriginRejection = Readonly<{
  method: string;
  route: string;
  reason: OriginRejectionReason;
  correlationId: string;
}>;

export type RequestOriginOptions = Readonly<{
  canonical: string;
  onRejected?: (rejection: OriginRejection) => void;
}>;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ROUTE_CATEGORY = /^[a-z]+(?:-[a-z]+)*$/;
const MAX_ROUTE_CATEGORY_LENGTH = 40;

export class RequestOriginRejectedError extends AppError {
  constructor() {
    super("REQUEST_ORIGIN_REJECTED", 403, "La solicitud no proviene de la aplicación.");
  }
}

/** `scheme://host[:port]` de una URL `http` o `https`; falla con cualquier otra. */
export function canonicalOrigin(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("El origen canónico debe ser http o https.");
  }
  return parsed.origin;
}

function originRejection(
  origin: string | undefined,
  canonical: string,
): OriginRejectionReason | null {
  if (origin === undefined) return "missing_origin";
  if (origin === "null") return "null_origin";
  let serialized: string;
  try {
    serialized = new URL(origin).origin;
  } catch {
    return "malformed_origin";
  }
  // Un origen bien formado se serializa igual que lo envía el navegador: sin ruta, sin barra final,
  // sin usuario y sin el puerto por defecto.
  if (serialized !== origin) return "malformed_origin";
  return origin === canonical ? null : "origin_mismatch";
}

/** La regla que rechaza la petición, o null si sigue. El orden es el de design D1. */
export function evaluateRequestOrigin(
  method: string,
  headers: IncomingHttpHeaders,
  canonical: string,
): OriginRejectionReason | null {
  if (method === "OPTIONS") return null;
  const site = headers["sec-fetch-site"];
  if (site === "same-site") return "fetch_site_same_site";
  if (site === "cross-site") return "fetch_site_cross_site";
  return MUTATING_METHODS.has(method) ? originRejection(headers.origin, canonical) : null;
}

/** El primer segmento tras /api/v1 cuando es un nombre de recurso; si no, `unknown`. */
export function routeCategory(path: string): string {
  const segment = path.split("/")[1] ?? "";
  return segment.length <= MAX_ROUTE_CATEGORY_LENGTH && ROUTE_CATEGORY.test(segment)
    ? segment
    : "unknown";
}

/** Se monta en /api/v1 antes del parser JSON y de la sesión (design D1). */
export function requestOriginGuard(options: RequestOriginOptions): RequestHandler {
  return (req, res, next) => {
    const reason = evaluateRequestOrigin(req.method, req.headers, options.canonical);
    if (reason === null) {
      next();
      return;
    }
    options.onRejected?.({
      method: req.method,
      route: routeCategory(req.path),
      reason,
      correlationId: req.requestId,
    });
    res.set("Cache-Control", "no-store");
    next(new RequestOriginRejectedError());
  };
}

// Resolución del contexto de petición (design D3): sesión de Better Auth -> membresía ACTIVE ->
// RequestContext. Nada sale de la petición: ni empresa ni rol. Se consulta en cada petición, sin
// caché, para que un cambio de rol o una desactivación rijan en la siguiente operación.
import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler, Response } from "express";
import { UnauthenticatedError } from "../../../../platform/http/errors.ts";
import type { MembershipReader } from "../../application/memberships.ts";
import type { RequestContext } from "../../application/request-context.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- augmentación ambiental de Express
  namespace Express {
    interface Locals {
      context?: RequestContext;
    }
  }
}

export type ContextDependencies = {
  getSessionUserId: (headers: IncomingHttpHeaders) => Promise<string | null>;
  memberships: Pick<MembershipReader, "findActiveForSessionUser">;
};

/** 401 con el mismo cuerpo sin sesión y sin membresía activa: no revela si la identidad existe. */
export function requireContext({
  getSessionUserId,
  memberships,
}: ContextDependencies): RequestHandler {
  return async (req, res, next) => {
    const userId = await getSessionUserId(req.headers);
    const membership = userId ? await memberships.findActiveForSessionUser(userId) : null;
    if (!userId || !membership) throw new UnauthenticatedError();
    res.locals.context = Object.freeze({
      userId,
      companyId: membership.companyId,
      role: membership.role,
      requestId: req.requestId,
    });
    next();
  };
}

/** El contexto resuelto por requireContext; falla si la ruta no está protegida. */
export function contextOf(res: Response): RequestContext {
  const context = res.locals.context;
  if (!context) throw new Error("Ruta protegida montada sin requireContext");
  return context;
}

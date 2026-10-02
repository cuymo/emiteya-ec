// Autorización en el orden de design D4: permiso, pertenencia del usuario objetivo a la empresa y
// validación del resto del payload. Quien no tiene permiso no aprende nada de los errores de
// validación, y un usuario de otra empresa es indistinguible de uno inexistente.
import type { z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../platform/http/errors.ts";
import { can, type Permission } from "../domain/access-policy.ts";
import type { CompanyMember, MembershipReader } from "./memberships.ts";
import type { RequestContext } from "./request-context.ts";
import type { SecurityEventSink } from "./security-events.ts";

export class UserNotFoundError extends NotFoundError {
  constructor() {
    super("USER_NOT_FOUND", "El usuario no existe.");
  }
}

/** Valida con el esquema; el mensaje es el del primer problema, que nombra el campo inválido. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(result.error, result.error.issues[0]?.message);
  return result.data;
}

export type AuthorizationDependencies = {
  memberships: MembershipReader;
  securityEvents: SecurityEventSink;
};

export function createAuthorizer({ memberships, securityEvents }: AuthorizationDependencies) {
  const deny = (ctx: RequestContext, action: Permission, status: 403 | 404) =>
    securityEvents.emit({
      type: "authorization_denied",
      actorUserId: ctx.userId,
      companyId: ctx.companyId,
      action,
      status,
      correlationId: ctx.requestId,
    });

  /** Paso 1: el permiso del rol de la membresía. Cada denegación es un evento de seguridad (D13). */
  function requirePermission(ctx: RequestContext, action: Permission): void {
    if (can(ctx.role, action)) return;
    deny(ctx, action, 403);
    throw new ForbiddenError();
  }

  /** Pasos 1 y 2: permiso y pertenencia del usuario objetivo a la empresa del contexto. */
  async function requireMember(
    ctx: RequestContext,
    action: Permission,
    targetUserId: string,
  ): Promise<CompanyMember> {
    requirePermission(ctx, action);
    const target = await memberships.findInCompany(ctx.companyId, targetUserId);
    if (target) return target;
    deny(ctx, action, 404);
    throw new UserNotFoundError();
  }

  /**
   * Paso 2 para recursos propios de la empresa (add-taxpayer-setup, design D12): un recurso ausente
   * o de otra empresa responde igual, con 404, y la denegación es un evento de seguridad.
   */
  function missingResource<E extends NotFoundError>(
    ctx: RequestContext,
    action: Permission,
    error: E,
  ): E {
    deny(ctx, action, 404);
    return error;
  }

  return { requirePermission, requireMember, missingResource };
}

export type Authorizer = ReturnType<typeof createAuthorizer>;

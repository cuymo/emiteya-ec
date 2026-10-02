// Casos de uso de la cuenta propia y la administración de usuarios (design D3 a D6 y D10). Orden:
// autorización -> pertenencia -> validación -> reglas -> transacción con auditoría -> respuesta.
import { listUsersQuerySchema, type UserSchemas } from "@facturador/contracts";
import { ConflictError } from "../../../platform/http/errors.ts";
import { isNoOp, selfChangeViolation, type SelfChangeViolation } from "../domain/access-rules.ts";
import type { MembershipStatus, Role } from "../domain/roles.ts";
import { parseInput, UserNotFoundError, type Authorizer } from "./authorization.ts";
import type { CompanyMember, MemberPage, MembershipReader } from "./memberships.ts";
import type { RequestContext } from "./request-context.ts";
import { EmailInUseError, type UnitOfWork } from "./unit-of-work.ts";

const SELF_CHANGE_MESSAGES: Record<SelfChangeViolation, string> = {
  OWN_ROLE: "No puedes cambiar tu propio rol.",
  OWN_STATUS: "No puedes cambiar tu propio acceso.",
  OWN_PASSWORD: "Para cambiar tu contraseña usa Mi cuenta, que pide la contraseña actual.",
};

export type UserAdministrationDependencies = {
  uow: UnitOfWork;
  memberships: MembershipReader;
  authorizer: Authorizer;
  schemas: UserSchemas;
};

export function createUserAdministration({
  uow,
  memberships,
  authorizer,
  schemas,
}: UserAdministrationDependencies) {
  function rejectSelfChange(
    action: "changeRole" | "changeStatus" | "setPassword",
    ctx: RequestContext,
    target: CompanyMember,
  ) {
    const violation = selfChangeViolation(action, ctx.userId, target.userId);
    if (violation) throw new ConflictError(violation, SELF_CHANGE_MESSAGES[violation]);
  }

  /** Relee la membresía dentro de la transacción: la diferencia decide si hay cambio y evento. */
  async function current(
    scope: { memberships: MembershipReader },
    ctx: RequestContext,
    userId: string,
  ) {
    const member = await scope.memberships.findInCompany(ctx.companyId, userId);
    if (!member) throw new UserNotFoundError();
    return member;
  }

  return {
    async getMe(ctx: RequestContext): Promise<CompanyMember> {
      authorizer.requirePermission(ctx, "account.read");
      const me = await memberships.findInCompany(ctx.companyId, ctx.userId);
      if (!me) throw new UserNotFoundError();
      return me;
    },

    async listUsers(
      ctx: RequestContext,
      query: unknown,
    ): Promise<MemberPage & { page: number; pageSize: number }> {
      authorizer.requirePermission(ctx, "users.read");
      const { search, status, page, pageSize } = parseInput(listUsersQuerySchema, query);
      const result = await memberships.listInCompany(ctx.companyId, {
        page,
        pageSize,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
      });
      return { ...result, page, pageSize };
    },

    async createUser(ctx: RequestContext, body: unknown): Promise<CompanyMember> {
      authorizer.requirePermission(ctx, "users.create");
      // createUser de Better Auth no aplica la longitud: el esquema propio la exige (S-1, E2).
      const input = parseInput(schemas.createUser, body);
      try {
        return await uow.run(async (scope) => {
          const userId = await scope.identity.createUser({
            name: input.name,
            email: input.email,
            password: input.password,
          });
          await scope.identity.addMembership({
            companyId: ctx.companyId,
            userId,
            role: input.role,
          });
          await scope.audit.append({
            companyId: ctx.companyId,
            actor: { type: "USER", userId: ctx.userId },
            action: "user.created",
            targetUserId: userId,
            changes: { role: input.role },
            correlationId: ctx.requestId,
          });
          return current(scope, ctx, userId);
        });
      } catch (error) {
        if (error instanceof EmailInUseError)
          throw new ConflictError("EMAIL_IN_USE", error.message);
        throw error;
      }
    },

    async changeRole(
      ctx: RequestContext,
      targetUserId: string,
      body: unknown,
    ): Promise<CompanyMember> {
      const target = await authorizer.requireMember(ctx, "users.changeRole", targetUserId);
      const { role } = parseInput(schemas.changeRole, body);
      rejectSelfChange("changeRole", ctx, target);
      return uow.run(async (scope) => {
        const before = await current(scope, ctx, target.userId);
        if (isNoOp<Role>(before.role, role)) return before;
        await scope.identity.updateMembership(ctx.companyId, target.userId, { role });
        await scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "user.role_changed",
          targetUserId: target.userId,
          changes: { from: before.role, to: role },
          correlationId: ctx.requestId,
        });
        return { ...before, role };
      });
    },

    async changeStatus(
      ctx: RequestContext,
      targetUserId: string,
      body: unknown,
    ): Promise<CompanyMember> {
      const target = await authorizer.requireMember(ctx, "users.changeStatus", targetUserId);
      const { status } = parseInput(schemas.changeStatus, body);
      rejectSelfChange("changeStatus", ctx, target);
      return uow.run(async (scope) => {
        const before = await current(scope, ctx, target.userId);
        if (isNoOp<MembershipStatus>(before.status, status)) return before;
        await scope.identity.updateMembership(ctx.companyId, target.userId, { status });
        // Desactivar revoca las sesiones; el filtro de D3 rechaza cualquiera que sobreviviera (D6).
        if (status === "DEACTIVATED") await scope.identity.revokeSessions(target.userId);
        await scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: status === "DEACTIVATED" ? "user.deactivated" : "user.reactivated",
          targetUserId: target.userId,
          changes: { from: before.status, to: status },
          correlationId: ctx.requestId,
        });
        return { ...before, status };
      });
    },

    async setPassword(ctx: RequestContext, targetUserId: string, body: unknown): Promise<void> {
      const target = await authorizer.requireMember(ctx, "users.setPassword", targetUserId);
      const { password } = parseInput(schemas.setPassword, body);
      rejectSelfChange("setPassword", ctx, target);
      await uow.run(async (scope) => {
        // Reemplaza la contraseña e invalida todas las sesiones del usuario objetivo (D6).
        await scope.identity.setPassword(target.userId, password);
        await scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: "user.password_set",
          targetUserId: target.userId,
          correlationId: ctx.requestId,
        });
      });
    },
  };
}

export type UserAdministration = ReturnType<typeof createUserAdministration>;

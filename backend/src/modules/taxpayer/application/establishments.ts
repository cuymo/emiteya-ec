// Casos de uso de establecimientos y puntos de emisión (design D7, D11 y D12). Orden: permiso ->
// pertenencia del recurso a la empresa (404 con evento de seguridad) -> validación -> transacción
// con el estado vigente -> sin cambio no hay escritura ni evento.
import {
  changeEstablishmentStatusSchema,
  createEmissionPointSchema,
  createEstablishmentSchema,
  updateEstablishmentSchema,
} from "@facturador/contracts";
import { ConflictError, NotFoundError } from "../../../platform/http/errors.ts";
import type { AuditAction } from "../../audit/domain/audit-event.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { Permission } from "../../identity/domain/access-policy.ts";
import type { ActiveStatus } from "../domain/emission-structure.ts";
import {
  DuplicateCodeError,
  type EmissionPointRecord,
  type EstablishmentRecord,
  type EstablishmentRepository,
  type TaxpayerScope,
  type TaxpayerUnitOfWork,
} from "./ports.ts";

const establishmentNotFound = () =>
  new NotFoundError("ESTABLISHMENT_NOT_FOUND", "El establecimiento no existe.");
const emissionPointNotFound = () =>
  new NotFoundError("EMISSION_POINT_NOT_FOUND", "El punto de emisión no existe.");

export type EstablishmentsDependencies = {
  uow: TaxpayerUnitOfWork;
  establishments: Pick<EstablishmentRepository, "list" | "find" | "findPoint">;
  authorizer: Authorizer;
};

export function createEstablishments({
  uow,
  establishments,
  authorizer,
}: EstablishmentsDependencies) {
  const MANAGE: Permission = "establishments.manage";

  async function requireEstablishment(ctx: RequestContext, id: string) {
    authorizer.requirePermission(ctx, MANAGE);
    const found = await establishments.find(ctx.companyId, id);
    if (!found) throw authorizer.missingResource(ctx, MANAGE, establishmentNotFound());
    return found;
  }

  const audit = (
    scope: TaxpayerScope,
    ctx: RequestContext,
    action: AuditAction,
    changes: Record<string, string | null>,
  ) =>
    scope.audit.append({
      companyId: ctx.companyId,
      actor: { type: "USER", userId: ctx.userId },
      action,
      changes,
      correlationId: ctx.requestId,
    });

  const target = (establishment: EstablishmentRecord) => ({
    establishmentId: establishment.id,
    establishmentCode: establishment.code,
  });

  const STATUS_ACTIONS: Record<
    "establishment" | "emission_point",
    Record<ActiveStatus, AuditAction>
  > = {
    establishment: { ACTIVE: "establishment.reactivated", INACTIVE: "establishment.deactivated" },
    emission_point: {
      ACTIVE: "emission_point.reactivated",
      INACTIVE: "emission_point.deactivated",
    },
  };

  return {
    async list(ctx: RequestContext): Promise<EstablishmentRecord[]> {
      authorizer.requirePermission(ctx, "establishments.read");
      return establishments.list(ctx.companyId);
    },

    async createEstablishment(ctx: RequestContext, body: unknown): Promise<EstablishmentRecord> {
      authorizer.requirePermission(ctx, MANAGE);
      const input = parseInput(createEstablishmentSchema, body);
      try {
        return await uow.run(async (scope) => {
          const created = await scope.establishments.create(ctx.companyId, input);
          await audit(scope, ctx, "establishment.created", {
            ...target(created),
            "address.to": created.address,
          });
          return created;
        });
      } catch (error) {
        if (error instanceof DuplicateCodeError) {
          throw new ConflictError(
            "ESTABLISHMENT_CODE_TAKEN",
            `Ya existe un establecimiento con el código ${input.code}.`,
          );
        }
        throw error;
      }
    },

    /** Corrige la dirección; el código no cambia (design D7). */
    async updateEstablishment(
      ctx: RequestContext,
      establishmentId: string,
      body: unknown,
    ): Promise<EstablishmentRecord> {
      await requireEstablishment(ctx, establishmentId);
      const { address } = parseInput(updateEstablishmentSchema, body);
      return uow.run(async (scope) => {
        const before = await scope.establishments.find(ctx.companyId, establishmentId);
        if (!before) throw establishmentNotFound();
        if (before.address === address) return before;
        const after = await scope.establishments.update(ctx.companyId, establishmentId, {
          address,
        });
        await audit(scope, ctx, "establishment.updated", {
          ...target(before),
          "address.from": before.address,
          "address.to": address,
        });
        return after;
      });
    },

    async changeEstablishmentStatus(
      ctx: RequestContext,
      establishmentId: string,
      body: unknown,
    ): Promise<EstablishmentRecord> {
      await requireEstablishment(ctx, establishmentId);
      const { status } = parseInput(changeEstablishmentStatusSchema, body);
      return uow.run(async (scope) => {
        const before = await scope.establishments.find(ctx.companyId, establishmentId);
        if (!before) throw establishmentNotFound();
        if (before.status === status) return before;
        const after = await scope.establishments.update(ctx.companyId, establishmentId, { status });
        await audit(scope, ctx, STATUS_ACTIONS.establishment[status], {
          ...target(before),
          "status.from": before.status,
          "status.to": status,
        });
        return after;
      });
    },

    async createEmissionPoint(
      ctx: RequestContext,
      establishmentId: string,
      body: unknown,
    ): Promise<{ establishment: EstablishmentRecord; point: EmissionPointRecord }> {
      const establishment = await requireEstablishment(ctx, establishmentId);
      const { code } = parseInput(createEmissionPointSchema, body);
      try {
        const point = await uow.run(async (scope) => {
          const created = await scope.establishments.createPoint(ctx.companyId, establishmentId, {
            code,
          });
          await audit(scope, ctx, "emission_point.created", {
            ...target(establishment),
            emissionPointId: created.id,
            emissionPointCode: created.code,
          });
          return created;
        });
        return { establishment, point };
      } catch (error) {
        if (error instanceof DuplicateCodeError) {
          throw new ConflictError(
            "EMISSION_POINT_CODE_TAKEN",
            `Ya existe un punto de emisión con el código ${code} en este establecimiento.`,
          );
        }
        throw error;
      }
    },

    async changeEmissionPointStatus(
      ctx: RequestContext,
      establishmentId: string,
      emissionPointId: string,
      body: unknown,
    ): Promise<{ establishment: EstablishmentRecord; point: EmissionPointRecord }> {
      const establishment = await requireEstablishment(ctx, establishmentId);
      const point = await establishments.findPoint(ctx.companyId, establishmentId, emissionPointId);
      if (!point) throw authorizer.missingResource(ctx, MANAGE, emissionPointNotFound());
      const { status } = parseInput(changeEstablishmentStatusSchema, body);
      const updated = await uow.run(async (scope) => {
        const before = await scope.establishments.findPoint(
          ctx.companyId,
          establishmentId,
          emissionPointId,
        );
        if (!before) throw emissionPointNotFound();
        if (before.status === status) return before;
        const after = await scope.establishments.updatePoint(
          ctx.companyId,
          establishmentId,
          emissionPointId,
          { status },
        );
        await audit(scope, ctx, STATUS_ACTIONS.emission_point[status], {
          ...target(establishment),
          emissionPointId: before.id,
          emissionPointCode: before.code,
          "status.from": before.status,
          "status.to": status,
        });
        return after;
      });
      return { establishment, point: updated };
    },
  };
}

export type Establishments = ReturnType<typeof createEstablishments>;

// Punto de emisión predeterminado propio (design D8, ERS RF-113, Q-23). Cada usuario elige el suyo
// entre los puntos disponibles de su empresa; solo preselecciona y no concede ni restringe acceso.
// Es una preferencia personal: no se audita.
import { setDefaultEmissionPointSchema } from "@facturador/contracts";
import { ConflictError, NotFoundError } from "../../../platform/http/errors.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import { isEmissionPointAvailable } from "../domain/emission-structure.ts";
import type {
  DefaultEmissionPointRepository,
  EmissionPointRecord,
  EstablishmentRecord,
  EstablishmentRepository,
} from "./ports.ts";

export type DefaultEmissionPoint = Readonly<{
  point: EmissionPointRecord;
  establishment: EstablishmentRecord;
  available: boolean;
}>;

export type DefaultEmissionPointDependencies = {
  defaults: DefaultEmissionPointRepository;
  establishments: Pick<EstablishmentRepository, "findPointWithEstablishment">;
  authorizer: Authorizer;
};

export function createDefaultEmissionPoint({
  defaults,
  establishments,
  authorizer,
}: DefaultEmissionPointDependencies) {
  async function current(ctx: RequestContext): Promise<DefaultEmissionPoint | null> {
    const found = await defaults.find(ctx.companyId, ctx.userId);
    return found
      ? { ...found, available: isEmissionPointAvailable(found.point, found.establishment) }
      : null;
  }

  return {
    async get(ctx: RequestContext): Promise<DefaultEmissionPoint | null> {
      authorizer.requirePermission(ctx, "account.read");
      return current(ctx);
    },

    async set(ctx: RequestContext, body: unknown): Promise<DefaultEmissionPoint | null> {
      authorizer.requirePermission(ctx, "account.setDefaultEmissionPoint");
      const { emissionPointId } = parseInput(setDefaultEmissionPointSchema, body);
      if (emissionPointId !== null) {
        const found = await establishments.findPointWithEstablishment(
          ctx.companyId,
          emissionPointId,
        );
        if (!found) {
          throw authorizer.missingResource(
            ctx,
            "account.setDefaultEmissionPoint",
            new NotFoundError("EMISSION_POINT_NOT_FOUND", "El punto de emisión no existe."),
          );
        }
        if (!isEmissionPointAvailable(found.point, found.establishment)) {
          throw new ConflictError(
            "EMISSION_POINT_UNAVAILABLE",
            "Ese punto de emisión no está disponible. Elige un punto activo de un establecimiento activo.",
          );
        }
      }
      await defaults.set(ctx.companyId, ctx.userId, emissionPointId);
      return current(ctx);
    },
  };
}

export type DefaultEmissionPointService = ReturnType<typeof createDefaultEmissionPoint>;

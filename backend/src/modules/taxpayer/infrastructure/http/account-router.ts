// Rutas del punto predeterminado propio y del estado de la empresa bajo /api/v1 (design D8, D9 y
// D12). GET /me no cambia: su contrato es de user-access.
import { Router } from "express";
import type { CompanyStatus, DefaultEmissionPointView } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { CompanyStatusService } from "../../application/company-status.ts";
import type {
  DefaultEmissionPoint,
  DefaultEmissionPointService,
} from "../../application/default-emission-point.ts";

export function toDefaultEmissionPointView(
  value: DefaultEmissionPoint | null,
): DefaultEmissionPointView {
  if (!value) return null;
  const { establishment, point } = value;
  return {
    establishment: {
      id: establishment.id,
      code: establishment.code,
      address: establishment.address,
      status: establishment.status,
    },
    emissionPoint: { id: point.id, code: point.code, status: point.status },
    available: value.available,
  };
}

export function accountRouter({
  defaults,
  status,
}: {
  defaults: DefaultEmissionPointService;
  status: CompanyStatusService;
}): Router {
  const router = Router();

  router.get("/me/default-emission-point", async (_req, res) => {
    res.status(200).json({ data: toDefaultEmissionPointView(await defaults.get(contextOf(res))) });
  });

  router.put("/me/default-emission-point", async (req, res) => {
    const updated = await defaults.set(contextOf(res), req.body);
    res.status(200).json({ data: toDefaultEmissionPointView(updated) });
  });

  router.get("/company/status", async (_req, res) => {
    const current = await status.get(contextOf(res));
    const data: CompanyStatus = {
      environment: current.environment,
      displayName: current.displayName,
      readiness: { ready: current.readiness.ready, checks: [...current.readiness.checks] },
    };
    res.status(200).json({ data });
  });

  return router;
}

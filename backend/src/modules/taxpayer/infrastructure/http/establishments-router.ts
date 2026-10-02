// Rutas de establecimientos y puntos de emisión bajo /api/v1 (design D7 y D12). Un punto se busca
// siempre bajo su establecimiento; ninguna ruta cambia el código ni el establecimiento de un punto.
import { Router, type Response } from "express";
import type { EmissionPointView, EstablishmentView } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { EmissionPointRecord, EstablishmentRecord } from "../../application/ports.ts";
import type { Establishments } from "../../application/establishments.ts";
import { isEmissionPointAvailable } from "../../domain/emission-structure.ts";

export function toEmissionPointView(
  point: EmissionPointRecord,
  establishment: EstablishmentRecord,
): EmissionPointView {
  return {
    id: point.id,
    code: point.code,
    status: point.status,
    available: isEmissionPointAvailable(point, establishment),
  };
}

export function toEstablishmentView(establishment: EstablishmentRecord): EstablishmentView {
  return {
    id: establishment.id,
    code: establishment.code,
    address: establishment.address,
    status: establishment.status,
    emissionPoints: establishment.emissionPoints.map((point) =>
      toEmissionPointView(point, establishment),
    ),
  };
}

function send<T>(res: Response, status: number, data: T) {
  res.status(status).json({ data });
}

export function establishmentsRouter(establishments: Establishments): Router {
  const router = Router();

  router.get("/establishments", async (_req, res) => {
    send(res, 200, (await establishments.list(contextOf(res))).map(toEstablishmentView));
  });

  router.post("/establishments", async (req, res) => {
    const created = await establishments.createEstablishment(contextOf(res), req.body);
    send(res, 201, toEstablishmentView(created));
  });

  router.put("/establishments/:establishmentId", async (req, res) => {
    const updated = await establishments.updateEstablishment(
      contextOf(res),
      req.params.establishmentId,
      req.body,
    );
    send(res, 200, toEstablishmentView(updated));
  });

  router.put("/establishments/:establishmentId/status", async (req, res) => {
    const updated = await establishments.changeEstablishmentStatus(
      contextOf(res),
      req.params.establishmentId,
      req.body,
    );
    send(res, 200, toEstablishmentView(updated));
  });

  router.post("/establishments/:establishmentId/emission-points", async (req, res) => {
    const { establishment, point } = await establishments.createEmissionPoint(
      contextOf(res),
      req.params.establishmentId,
      req.body,
    );
    send(res, 201, toEmissionPointView(point, establishment));
  });

  router.put(
    "/establishments/:establishmentId/emission-points/:emissionPointId/status",
    async (req, res) => {
      const { establishment, point } = await establishments.changeEmissionPointStatus(
        contextOf(res),
        req.params.establishmentId,
        req.params.emissionPointId,
        req.body,
      );
      send(res, 200, toEmissionPointView(point, establishment));
    },
  );

  return router;
}

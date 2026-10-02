// Rutas de la consulta y el ajuste de secuenciales bajo /api/v1 (add-fiscal-numbering, design D12).
// Ninguna ruta reserva: la reserva es una operación interna de la emisión. El valor interno de
// agotado nunca sale: un contador agotado es `exhausted: true` con `nextNumber: null`.
import { Router } from "express";
import type { FiscalSequenceView } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import { isEmissionPointAvailable } from "../../../taxpayer/domain/emission-structure.ts";
import type {
  CounterEntry,
  SequenceAdministration,
} from "../../application/sequence-administration.ts";
import { isExhausted, visibleNextNumber } from "../../domain/numbering.ts";

export function toFiscalSequenceView({
  establishment,
  point,
  key,
  counter,
}: CounterEntry): FiscalSequenceView {
  return {
    establishment: { id: establishment.id, code: establishment.code, status: establishment.status },
    emissionPoint: {
      id: point.id,
      code: point.code,
      status: point.status,
      available: isEmissionPointAvailable(point, establishment),
    },
    environment: key.environment,
    documentType: key.documentType,
    nextNumber: visibleNextNumber(counter),
    lastReserved: counter.lastReserved,
    exhausted: isExhausted(counter),
  };
}

export function sequencesRouter(administration: SequenceAdministration): Router {
  const router = Router();

  router.get("/fiscal-sequences", async (req, res) => {
    const entries = await administration.list(contextOf(res), req.query);
    res.status(200).json({ data: entries.map(toFiscalSequenceView) });
  });

  router.put(
    "/establishments/:establishmentId/emission-points/:emissionPointId/sequences/:environment/:documentType",
    async (req, res) => {
      const entry = await administration.adjust(contextOf(res), req.params, req.body);
      res.status(200).json({ data: toFiscalSequenceView(entry) });
    },
  );

  return router;
}

// Rutas de los catálogos fiscales bajo /api/v1 (add-fiscal-catalogs, design D11). No hay rutas para
// crear ni modificar datos oficiales: esas peticiones reciben 404 como cualquier ruta inexistente.
import { Router } from "express";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { FiscalCatalogs } from "../../application/fiscal-catalogs.ts";

export function fiscalCatalogsRouter(service: FiscalCatalogs): Router {
  const router = Router();

  router.get("/fiscal-catalogs", async (_req, res) => {
    res.status(200).json({ data: await service.catalogs(contextOf(res)) });
  });

  router.get("/fiscal-catalogs/consumer-final-policy", async (req, res) => {
    res.status(200).json({ data: await service.consumerFinalPolicy(contextOf(res), req.query) });
  });

  router.get("/fiscal-catalogs/schemas", async (_req, res) => {
    res.status(200).json({ data: await service.schemas(contextOf(res)) });
  });

  router.get("/fiscal-catalogs/special-cases", async (_req, res) => {
    res.status(200).json({ data: await service.specialCases(contextOf(res)) });
  });

  router.get("/fiscal-catalogs/:catalogType/entries", async (req, res) => {
    res
      .status(200)
      .json({ data: await service.entries(contextOf(res), req.params.catalogType, req.query) });
  });

  router.put("/fiscal-catalogs/:catalogType/entries/:entryKey/enablement", async (req, res) => {
    res.status(200).json({
      data: await service.setEnablement(
        contextOf(res),
        req.params.catalogType,
        req.params.entryKey,
        req.body,
      ),
    });
  });

  return router;
}

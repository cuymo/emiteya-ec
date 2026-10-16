// Ruta del tablero de Inicio bajo /api/v1: la empresa sale de la sesión.
import { Router } from "express";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { Dashboard } from "../../application/dashboard.ts";

export function dashboardRouter(dashboard: Dashboard): Router {
  const router = Router();
  router.get("/dashboard", async (_req, res) => {
    res.status(200).json({ data: await dashboard.summary(contextOf(res)) });
  });
  return router;
}

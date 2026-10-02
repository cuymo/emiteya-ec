// Endpoints internos de salud: liveness y readiness (fuera de /api; ADR 0016).
import { Router } from "express";

export type ReadinessCheck = () => Promise<boolean>;

export function healthRouter(readiness: ReadinessCheck): Router {
  const router = Router();
  router.get("/live", (_req, res) => {
    res.json({ status: "ok" });
  });
  router.get("/ready", async (_req, res) => {
    const ready = await readiness().catch(() => false);
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable" });
  });
  return router;
}

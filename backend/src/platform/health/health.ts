// Endpoints internos de salud: liveness y readiness (fuera de /api; ADR 0016).
import { Router } from "express";

/**
 * Resultado de la readiness con detalles seguros para el cuerpo, sin secretos ni configuración: textos
 * o valores serializables, como el diagnóstico de la sesión de certificación.
 */
export type Readiness = Readonly<{ ready: boolean; details?: Readonly<Record<string, unknown>> }>;

export type ReadinessCheck = () => Promise<boolean | Readiness>;

export function healthRouter(readiness: ReadinessCheck): Router {
  const router = Router();
  router.get("/live", (_req, res) => {
    res.json({ status: "ok" });
  });
  router.get("/ready", async (_req, res) => {
    const result = await readiness().catch(() => false);
    const { ready, details } = typeof result === "boolean" ? { ready: result } : result;
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable", ...details });
  });
  return router;
}

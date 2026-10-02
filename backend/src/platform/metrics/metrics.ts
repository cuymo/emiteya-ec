// Métricas en formato Prometheus (ERS RNF-012). Etiqueta las rutas por patrón, no por URL.
import type { Request, RequestHandler } from "express";
import { Histogram, Registry, collectDefaultMetrics } from "@prometheus-io/client";

export type Metrics = {
  registry: Registry;
  httpDuration: Histogram<"method" | "route" | "status_code">;
};

export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const httpDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "Duración de las peticiones HTTP por método, patrón de ruta y estado.",
    labelNames: ["method", "route", "status_code"] as const,
    registers: [registry],
  });
  return { registry, httpDuration };
}

function routePattern(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  return typeof route?.path === "string" ? `${req.baseUrl}${route.path}` : "unmatched";
}

export function recordHttpMetrics(metrics: Metrics): RequestHandler {
  return (req, res, next) => {
    const stop = metrics.httpDuration.startTimer();
    res.on("finish", () => {
      stop({ method: req.method, route: routePattern(req), status_code: String(res.statusCode) });
    });
    next();
  };
}

export function metricsHandler(metrics: Metrics): RequestHandler {
  return async (_req, res) => {
    res.type(metrics.registry.contentType).send(await metrics.registry.metrics());
  };
}

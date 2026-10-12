// Arma la aplicación HTTP. El orden de los middleware está documentado en docs/architecture/backend.md.
import express, { Router, type Express, type Request } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import { errorHandler, notFound } from "./platform/http/error-handler.ts";
import { requestId } from "./platform/http/request-id.ts";
import { requestOriginGuard, type RequestOriginOptions } from "./platform/http/request-origin.ts";
import { metricsHandler, recordHttpMetrics, type Metrics } from "./platform/metrics/metrics.ts";
import { healthRouter, type ReadinessCheck } from "./platform/health/health.ts";

export const JSON_BODY_LIMIT = "100kb";

export type AppDependencies = {
  logger: Logger;
  metrics: Metrics;
  readiness: ReadinessCheck;
  trustProxy?: boolean | number | string;
  /** Origen canónico de /api/v1 y aviso de cada rechazo (enforce-api-origin-and-body-limits, D1). */
  requestOrigin: RequestOriginOptions;
  /** Rutas de aplicación bajo /api/v1 (ADR 0015). */
  apiRouter?: Router;
  /** Montaje de routers que necesitan el cuerpo sin procesar (por ejemplo, Better Auth). */
  mountBeforeBodyParser?: (app: Express) => void;
  /** Rutas que traen su propio parser JSON con otro límite (la carga de la firma electrónica). */
  jsonBodyExceptions?: (req: Request) => boolean;
};

export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", deps.trustProxy ?? false);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req) => (req as express.Request).requestId,
      // Minimización: ni cabeceras, ni IP, ni cuerpos en los logs de petición (docs/quality/observability.md).
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(helmet());
  app.use(recordHttpMetrics(deps.metrics));

  app.use("/health", healthRouter(deps.readiness));
  app.get("/metrics", metricsHandler(deps.metrics));

  deps.mountBeforeBodyParser?.(app);
  // Antes de leer cualquier cuerpo y de consultar la sesión.
  app.use("/api/v1", requestOriginGuard(deps.requestOrigin));

  const json = express.json({ limit: JSON_BODY_LIMIT });
  app.use((req, res, next) => (deps.jsonBodyExceptions?.(req) ? next() : json(req, res, next)));
  app.use("/api/v1", deps.apiRouter ?? Router());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

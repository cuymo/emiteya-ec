// Arma la aplicación con logs capturados en memoria para las pruebas.
import type { Router } from "express";
import { createApp } from "../src/app.ts";
import type { ReadinessCheck } from "../src/platform/health/health.ts";
import { createLogger } from "../src/platform/logging/logger.ts";
import { createMetrics } from "../src/platform/metrics/metrics.ts";
import { TEST_ORIGIN } from "./support/http-client.ts";

export function buildTestApp(
  options: {
    apiRouter?: Router;
    readiness?: ReadinessCheck;
    trustProxy?: false | number | string;
  } = {},
) {
  const lines: string[] = [];
  const logger = createLogger("info", { write: (line: string) => void lines.push(line) });
  const metrics = createMetrics();
  const app = createApp({
    logger,
    metrics,
    readiness: options.readiness ?? (() => Promise.resolve(true)),
    requestOrigin: { canonical: TEST_ORIGIN },
    ...(options.trustProxy !== undefined ? { trustProxy: options.trustProxy } : {}),
    ...(options.apiRouter ? { apiRouter: options.apiRouter } : {}),
  });
  return { app, metrics, logs: () => lines.join("") };
}

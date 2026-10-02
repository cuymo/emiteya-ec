import type { AddressInfo } from "node:net";
import { Router } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createShutdown } from "../src/platform/lifecycle/shutdown.ts";
import { createLogger } from "../src/platform/logging/logger.ts";
import { buildTestApp } from "./helpers.ts";

describe("métricas", () => {
  it("expone métricas de proceso y el histograma por patrón de ruta, no por URL", async () => {
    const router = Router();
    router.get("/examples/:exampleId", (_req, res) => {
      res.json({ data: {} });
    });
    const { app } = buildTestApp({ apiRouter: router });
    await request(app).get("/api/v1/examples/12345");
    const res = await request(app).get("/metrics");

    expect(res.status).toBe(200);
    expect(res.text).toContain("process_cpu_user_seconds_total");
    expect(res.text).toMatch(
      /http_request_duration_seconds_count\{[^}]*route="\/api\/v1\/examples\/:exampleId"/,
    );
    expect(res.text).not.toContain("/examples/12345");
  });
});

describe("apagado ordenado", () => {
  it("deja de aceptar conexiones y cierra los recursos registrados", async () => {
    const { app } = buildTestApp();
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;
    const close = vi.fn(() => Promise.resolve());
    const shutdown = createShutdown({
      server,
      closers: [{ name: "database", close }],
      logger: createLogger("silent"),
    });

    expect((await fetch(`http://127.0.0.1:${port}/health/live`)).status).toBe(200);
    await shutdown("SIGTERM");

    expect(close).toHaveBeenCalledOnce();
    expect(server.listening).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/health/live`)).rejects.toThrow();
  });
});

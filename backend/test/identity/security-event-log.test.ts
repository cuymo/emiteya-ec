// Rechazo por origen como evento de seguridad (enforce-api-origin-and-body-limits, design D8): la
// categoría de la ruta y no la URL, y un contador con solo el método y el motivo.
import { describe, expect, it } from "vitest";
import { createSecurityEventLog } from "../../src/modules/identity/infrastructure/security-event-log.ts";
import { createLogger } from "../../src/platform/logging/logger.ts";
import { createMetrics } from "../../src/platform/metrics/metrics.ts";

describe("registro de los rechazos por origen", () => {
  it("escribe el método, la categoría, el motivo y la correlación, y cuenta por método y motivo", async () => {
    const lines: string[] = [];
    const logger = createLogger("info", { write: (line: string) => void lines.push(line) });
    const metrics = createMetrics();
    const log = createSecurityEventLog(logger, metrics.registry);

    log.emit({
      type: "request_origin_rejected",
      method: "POST",
      route: "documents",
      reason: "origin_mismatch",
      correlationId: "correlacion-0001",
    });
    log.emit({
      type: "request_origin_rejected",
      method: "GET",
      route: "reports",
      reason: "fetch_site_cross_site",
      correlationId: "correlacion-0002",
    });

    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries[0]).toMatchObject({
      level: 40,
      channel: "security",
      event: "request_origin_rejected",
      method: "POST",
      route: "documents",
      reason: "origin_mismatch",
      requestId: "correlacion-0001",
    });
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      for (const key of ["url", "path", "origin", "referer", "headers", "ip"]) {
        expect(entry).not.toHaveProperty(key);
      }
    }

    const exposition = await metrics.registry.metrics();
    expect(exposition).toContain(
      'http_request_origin_rejections_total{method="POST",reason="origin_mismatch"} 1',
    );
    expect(exposition).toContain(
      'http_request_origin_rejections_total{method="GET",reason="fetch_site_cross_site"} 1',
    );
    expect(exposition).not.toMatch(/http_request_origin_rejections_total\{[^}]*route=/);
  });
});

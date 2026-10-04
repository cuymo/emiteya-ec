// Métricas del RIDE (add-document-archive, design D14), en el registro existente y sin datos de la
// empresa, del comprobante ni del comprador. Los jobs del RIDE ya salen en `fiscal_jobs` y en
// `fiscal_jobs_oldest_pending_age_seconds` con su tipo.
import { Counter, Gauge, Histogram, type Registry } from "@prometheus-io/client";
import type { PrismaClient } from "../../../../generated/prisma/client.ts";
import { RIDE_REJECTION_CODES } from "../../../sri-engine/application/ride.ts";
import { RIDE_STOP_CODES } from "../../application/archive/ride-handler.ts";
import type { RideObserver } from "../../application/archive/ride-ports.ts";

/** Códigos acotados de `ride_render_failures_total`: otro código cuenta como `OTHER`. */
const FAILURE_CODES: ReadonlySet<string> = new Set([
  ...RIDE_REJECTION_CODES,
  ...RIDE_STOP_CODES,
  "BUSY",
  "TIMEOUT",
  "WORKER",
  "CLOSED",
  "INTERNAL",
]);

export function registerRideMetrics(
  registry: Registry,
  sources: Readonly<{ prisma: PrismaClient }>,
): RideObserver {
  const renderDuration = new Histogram({
    name: "ride_render_duration_seconds",
    help: "Duración del render del RIDE en su worker, sin la espera de la cola.",
    buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2, 5, 10],
    registers: [registry],
  });
  const jobWait = new Histogram({
    name: "ride_job_wait_seconds",
    help: "Espera de un job del RIDE: del momento en que debía correr al inicio del render.",
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 300, 900],
    registers: [registry],
  });
  const failures = new Counter({
    name: "ride_render_failures_total",
    help: "Fallos de la generación del RIDE por código acotado.",
    labelNames: ["code"] as const,
    registers: [registry],
  });
  new Gauge({
    name: "documents_authorized_without_ride",
    help: "Comprobantes autorizados que todavía no tienen su RIDE guardado.",
    registers: [registry],
    async collect() {
      this.set(
        await sources.prisma.electronicDocument.count({
          where: { state: "AUTHORIZED", artifacts: { none: { kind: "RIDE_PDF" } } },
        }),
      );
    },
  });

  return {
    rendered: (seconds) => renderDuration.observe(seconds),
    waited: (seconds) => jobWait.observe(seconds),
    failed: (code) => failures.inc({ code: FAILURE_CODES.has(code) ? code : "OTHER" }),
  };
}

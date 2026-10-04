// Métricas de la transmisión al SRI (add-sri-transmission, design D21; CTX §48), en el registro
// existente y sin la empresa en las etiquetas: es una sola por instancia. Los gauges se calculan al
// consultar /metrics; los contadores y los histogramas los alimenta el procedimiento común de los
// handlers. Ninguna etiqueta lleva XML, SOAP, claves de acceso ni identificadores de empresa.
import { Counter, Gauge, Histogram, type Registry } from "@prometheus-io/client";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { SriService } from "../../sri-engine/application/transport.ts";
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import type { TransmissionObserver } from "../application/transmission-step.ts";

type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";
const ENVIRONMENTS: readonly Environment[] = ["TEST", "PRODUCTION"];
const SERVICES: readonly SriService[] = ["RECEPTION", "AUTHORIZATION", "VALIDITY"];
const TRACKED_CODES = new Set(["70", "43", "45"]);

export function registerTransmissionMetrics(
  registry: Registry,
  sources: Readonly<{
    prisma: PrismaClient;
    breakerState: (environment: Environment, service: SriService) => BreakerState;
    now?: () => Date;
  }>,
): TransmissionObserver {
  const now = sources.now ?? (() => new Date());

  new Gauge({
    name: "fiscal_jobs",
    help: "Jobs de la cola por tipo y estado: pendientes, en arriendo y detenidos.",
    labelNames: ["type", "status"] as const,
    registers: [registry],
    async collect() {
      this.reset();
      const rows = await sources.prisma.job.groupBy({
        by: ["type", "status"],
        where: { status: { in: ["PENDING", "LEASED", "STOPPED"] } },
        _count: { _all: true },
      });
      for (const row of rows) this.set({ type: row.type, status: row.status }, row._count._all);
    },
  });

  new Gauge({
    name: "fiscal_jobs_oldest_pending_age_seconds",
    help: "Antigüedad del job pendiente más viejo de cada tipo, en segundos.",
    labelNames: ["type"] as const,
    registers: [registry],
    async collect() {
      this.reset();
      const rows = await sources.prisma.job.groupBy({
        by: ["type"],
        where: { status: "PENDING" },
        _min: { createdAt: true },
      });
      for (const row of rows) {
        if (row._min.createdAt) {
          this.set({ type: row.type }, (now().getTime() - row._min.createdAt.getTime()) / 1_000);
        }
      }
    },
  });

  new Gauge({
    name: "fiscal_documents",
    help: "Comprobantes por estado fiscal, incluidos SEND_UNKNOWN y MANUAL_REVIEW.",
    labelNames: ["state"] as const,
    registers: [registry],
    async collect() {
      this.reset();
      const rows = await sources.prisma.electronicDocument.groupBy({
        by: ["state"],
        _count: { _all: true },
      });
      for (const row of rows) this.set({ state: row.state }, row._count._all);
    },
  });

  new Gauge({
    name: "sri_circuit_open",
    help: "1 si el circuit breaker del servicio y ambiente está abierto o en prueba, 0 si no.",
    labelNames: ["service", "environment"] as const,
    registers: [registry],
    collect() {
      for (const environment of ENVIRONMENTS) {
        for (const service of SERVICES) {
          this.set(
            { service, environment },
            sources.breakerState(environment, service) === "CLOSED" ? 0 : 1,
          );
        }
      }
    },
  });

  const attempts = new Counter({
    name: "sri_attempts_total",
    help: "Intentos con el SRI por operación y resultado de su clasificación.",
    labelNames: ["operation", "outcome"] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: "sri_request_duration_seconds",
    help: "Duración de las llamadas al SRI por operación, en segundos.",
    labelNames: ["operation"] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry],
  });
  const codes = new Counter({
    name: "sri_error_code_total",
    help: "Mensajes del SRI por identificador: 70, 43, 45 u otro.",
    labelNames: ["code"] as const,
    registers: [registry],
  });
  const latency = new Histogram({
    name: "invoice_authorization_latency_seconds",
    help: "Tiempo de SIGNED a AUTHORIZED, en segundos.",
    buckets: [5, 15, 30, 60, 300, 900, 3_600, 21_600, 86_400],
    registers: [registry],
  });

  return {
    attempt(operation, outcome, seconds, messages) {
      attempts.inc({ operation, outcome });
      duration.observe({ operation }, seconds);
      for (const message of messages) {
        const code = message.identifier?.trim() ?? "";
        if (code !== "") codes.inc({ code: TRACKED_CODES.has(code) ? code : "other" });
      }
    },
    authorized(seconds) {
      latency.observe(seconds);
    },
  };
}

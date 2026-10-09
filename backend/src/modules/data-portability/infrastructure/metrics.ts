// Métricas de la portabilidad (add-data-portability, design D21): resultados, fallas por código,
// duración por fase, tamaño de los paquetes, descargas y renovaciones del *lease* rechazadas. Sin
// empresa, usuario, rutas ni contenido en las etiquetas.
import { Counter, Histogram, type Registry } from "@prometheus-io/client";

export type DownloadResult = "started" | "not_ready" | "expired" | "integrity_failed" | "aborted";

export type PortabilityMetrics = Readonly<{
  ready(sizeBytes: number): void;
  failed(code: string): void;
  expired(): void;
  phase(phase: string, seconds: number): void;
  download(result: DownloadResult): void;
  leaseRenewalFailed(): void;
}>;

export function registerPortabilityMetrics(registry: Registry): PortabilityMetrics {
  const exports = new Counter({
    name: "data_exports_total",
    help: "Exportaciones de portabilidad por resultado: ready, failed o expired.",
    labelNames: ["result"] as const,
    registers: [registry],
  });
  const failures = new Counter({
    name: "data_export_failures_total",
    help: "Fallas de las exportaciones de portabilidad por código seguro.",
    labelNames: ["code"] as const,
    registers: [registry],
  });
  const phases = new Histogram({
    name: "data_export_phase_duration_seconds",
    help: "Duración de cada fase de la generación: SNAPSHOT, ARTIFACTS y PUBLISHING.",
    labelNames: ["phase"] as const,
    buckets: [1, 5, 15, 30, 60, 120, 300, 600, 1_800, 3_600],
    registers: [registry],
  });
  const sizes = new Histogram({
    name: "data_export_size_bytes",
    help: "Tamaño de cada paquete de portabilidad listo.",
    buckets: [2 ** 20, 2 ** 24, 2 ** 27, 2 ** 30, 2 ** 31, 2 ** 32, 2 ** 33, 2 ** 34],
    registers: [registry],
  });
  const downloads = new Counter({
    name: "data_export_downloads_total",
    help: "Descargas de paquetes por resultado: started, not_ready, expired, integrity_failed o aborted.",
    labelNames: ["result"] as const,
    registers: [registry],
  });
  const renewals = new Counter({
    name: "data_export_lease_renewals_failed_total",
    help: "Renovaciones del lease rechazadas: la generación se abortó sin publicar.",
    registers: [registry],
  });
  return {
    ready(sizeBytes) {
      exports.inc({ result: "ready" });
      sizes.observe(sizeBytes);
    },
    failed(code) {
      exports.inc({ result: "failed" });
      failures.inc({ code });
    },
    expired: () => exports.inc({ result: "expired" }),
    phase: (phase, seconds) => phases.observe({ phase }, seconds),
    download: (result) => downloads.inc({ result }),
    leaseRenewalFailed: () => renewals.inc(),
  };
}

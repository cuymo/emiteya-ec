// Métricas de las exportaciones (add-reports-export, design D17): el resultado por reporte, la
// duración de la generación y las filas de cada XLSX. Sin empresa, usuario ni filtros en las
// etiquetas.
import { Counter, Histogram, type Registry } from "@prometheus-io/client";
import type { ReportsObserver } from "../application/ports.ts";

export function registerReportMetrics(registry: Registry): ReportsObserver {
  const exports = new Counter({
    name: "report_exports_total",
    help: "Exportaciones de reportes por reporte y resultado: generated, row_limit, busy o failed.",
    labelNames: ["report", "result"] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: "report_export_duration_seconds",
    help: "Duración de la generación de un XLSX, del conteo a la auditoría, sin la entrega.",
    labelNames: ["report"] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    registers: [registry],
  });
  const rows = new Histogram({
    name: "report_export_rows",
    help: "Filas de cada XLSX generado.",
    buckets: [0, 100, 1_000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_048_575],
    registers: [registry],
  });
  return {
    exported: (report, result) => exports.inc({ report, result }),
    generated(report, seconds, count) {
      duration.observe({ report }, seconds);
      rows.observe(count);
    },
  };
}

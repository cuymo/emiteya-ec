// La documentación de los reportes cita las rutas, las variables, los permisos, la acción de
// auditoría y las métricas reales (add-reports-export, tarea 4.4).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REPORT_IDS, apiRoutes } from "@facturador/contracts";

const DOC = readFileSync(
  fileURLToPath(new URL("../../../docs/architecture/reports.md", import.meta.url)),
  "utf8",
);
const ENV = readFileSync(
  fileURLToPath(new URL("../../src/config/env.ts", import.meta.url)),
  "utf8",
);
const METRICS = readFileSync(
  fileURLToPath(new URL("../../src/modules/reports/infrastructure/metrics.ts", import.meta.url)),
  "utf8",
);

describe("docs/architecture/reports.md", () => {
  it("cita cada ruta registrada de los reportes", () => {
    const routes = apiRoutes.filter((route) => route.path.startsWith("/reports/"));
    expect(routes).toHaveLength(REPORT_IDS.length * 2);
    for (const report of REPORT_IDS) expect(DOC).toContain(`GET /api/v1/reports/${report}\``);
    expect(DOC).toContain("GET /api/v1/reports/{reporte}/export");
  });

  it("cita las variables del entorno, los permisos, la acción y las métricas reales", () => {
    for (const variable of ["REPORT_EXPORT_MAX_ROWS", "REPORT_EXPORT_MAX_CONCURRENT"]) {
      expect(ENV).toContain(`${variable}:`);
      expect(DOC).toContain(variable);
    }
    for (const permission of ["reports.read", "reports.export"]) expect(DOC).toContain(permission);
    expect(DOC).toContain("report.exported");
    for (const metric of [
      "report_exports_total",
      "report_export_duration_seconds",
      "report_export_rows",
    ]) {
      expect(METRICS).toContain(`"${metric}"`);
      expect(DOC).toContain(metric);
    }
  });
});

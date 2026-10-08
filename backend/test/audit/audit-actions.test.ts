// Acciones del rastro de auditoría (audit-trail): cada una es única, y la exportación de un reporte
// (add-reports-export, design D13) es una acción propia cuyos datos no parecen secretos.
import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTIONS,
  AuditSecretError,
  assertNoSecrets,
} from "../../src/modules/audit/domain/audit-event.ts";

describe("acciones de auditoría", () => {
  it("no repite ninguna acción", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it("incluye la exportación de un reporte, sin acciones para consultarlo", () => {
    expect(AUDIT_ACTIONS).toContain("report.exported");
    expect(AUDIT_ACTIONS.filter((action) => action.startsWith("report."))).toEqual([
      "report.exported",
    ]);
  });

  it("admite los datos de una exportación y sigue rechazando los que parecen secretos", () => {
    expect(() =>
      assertNoSecrets({
        report: "invoices",
        rows: 120,
        from: "2026-09-01",
        to: "2026-09-30",
        state: "AUTHORIZED",
        environment: "PRODUCTION",
        customerIdentificationFiltered: true,
      }),
    ).not.toThrow();
    expect(() => assertNoSecrets({ sessionToken: "x" })).toThrow(AuditSecretError);
  });

  it("incluye las cuatro acciones de la portabilidad, sin un downloaded ni eventos por comprobante", () => {
    expect(AUDIT_ACTIONS.filter((action) => action.startsWith("data_export."))).toEqual([
      "data_export.requested",
      "data_export.completed",
      "data_export.failed",
      "data_export.download_started",
    ]);
  });

  it("admite los datos de los eventos de portabilidad", () => {
    expect(() =>
      assertNoSecrets({
        exportId: "e1",
        formatVersion: "1",
        documents: 102_000,
        files: 520_000,
        environments: ["TEST", "PRODUCTION"],
        sizeBytes: "2600000000",
        sha256: "a".repeat(64),
      }),
    ).not.toThrow();
    expect(() => assertNoSecrets({ exportId: "e1", code: "DATA_EXPORT_FAILED" })).not.toThrow();
    expect(() => assertNoSecrets({ packageHash: "x" })).toThrow(AuditSecretError);
  });
});

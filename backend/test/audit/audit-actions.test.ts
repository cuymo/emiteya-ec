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
});

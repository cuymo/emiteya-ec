// Métricas de la firma (design D13, CTX §48): días para el vencimiento y si es utilizable, por
// empresa. Se calculan al consultar /metrics con una lectura de metadatos, sin descifrar nada.
import { Gauge, type Registry } from "@prometheus-io/client";
import type { CertificateValidity } from "../domain/certificate.ts";

export function registerSigningMetrics(
  registry: Registry,
  validityOfAll: () => Promise<{ companyId: string; validity: CertificateValidity }[]>,
): void {
  let snapshot: Promise<{ companyId: string; validity: CertificateValidity }[]> | null = null;
  // Una sola lectura por recolección para los dos gauges.
  const current = () => {
    snapshot ??= validityOfAll().finally(() => setTimeout(() => (snapshot = null), 0));
    return snapshot;
  };
  new Gauge({
    name: "signing_certificate_days_to_expiry",
    help: "Días que faltan para el vencimiento de la firma electrónica vigente.",
    labelNames: ["company_id"] as const,
    registers: [registry],
    async collect() {
      this.reset();
      for (const { companyId, validity } of await current())
        this.set({ company_id: companyId }, validity.daysToExpiry);
    },
  });
  new Gauge({
    name: "signing_certificate_usable",
    help: "1 si la firma electrónica vigente es utilizable para emitir, 0 si no.",
    labelNames: ["company_id"] as const,
    registers: [registry],
    async collect() {
      this.reset();
      for (const { companyId, validity } of await current())
        this.set({ company_id: companyId }, validity.usable ? 1 : 0);
    },
  });
}

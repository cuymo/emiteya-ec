// Métricas de las entregas (add-document-archive, design D14): cuentas por evento y fallos de
// integridad por tipo de artefacto. Ninguna se llama "entregado": son acciones de la aplicación.
import { Counter, type Registry } from "@prometheus-io/client";
import type { DeliveryObserver } from "../../application/archive/delivery-ports.ts";

export function registerDeliveryMetrics(registry: Registry): DeliveryObserver {
  const deliveries = new Counter({
    name: "document_deliveries_total",
    help: "Descargas servidas y solicitudes de impresión de documentos, por evento.",
    labelNames: ["event"] as const,
    registers: [registry],
  });
  const integrity = new Counter({
    name: "artifact_integrity_failures_total",
    help: "Documentos guardados que no pasaron la verificación de integridad al servirlos.",
    labelNames: ["kind"] as const,
    registers: [registry],
  });
  return {
    delivered: (event) => deliveries.inc({ event }),
    integrityFailed: (kind) => integrity.inc({ kind }),
  };
}

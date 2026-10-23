// Métricas del correo (add-email-delivery, design D13): los envíos terminados por resultado, la
// duración del SMTP y si el despliegue tiene el envío encendido. Sin empresas, comprobantes ni
// direcciones.
import { Counter, Gauge, Histogram, type Registry } from "@prometheus-io/client";
import type { EmailObserver } from "../application/ports.ts";

export function registerEmailMetrics(
  registry: Registry,
  policy: Readonly<{ deliveryEnabled: boolean }>,
): EmailObserver {
  const deliveries = new Counter({
    name: "email_delivery_total",
    help: "Envíos por correo terminados o reprogramados, por resultado.",
    labelNames: ["outcome"] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: "email_send_duration_seconds",
    help: "Duración de un envío SMTP: de la conexión a la respuesta del servidor.",
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry],
  });
  const enabled = new Gauge({
    name: "email_delivery_enabled",
    help: "1 si el despliegue tiene el envío de correos encendido (EMAIL_DELIVERY_ENABLED).",
    registers: [registry],
  });
  enabled.set(policy.deliveryEnabled ? 1 : 0);
  return {
    finished: (outcome) => deliveries.inc({ outcome }),
    sendDuration: (seconds) => duration.observe(seconds),
  };
}

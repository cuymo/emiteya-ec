// Métricas de las guías de remisión (add-shipping-guides, design D27): las reservas confirmadas y sus
// destinatarios por clase de sustento, con `internal_invoice` y `declared_exception` como únicos
// valores. Sin empresa ni comprobante como etiqueta. La transmisión, la autorización y el RIDE usan
// sus métricas vigentes.
import { Counter, type Registry } from "@prometheus-io/client";
import type { ShippingGuideEmissionObserver } from "../application/emission.ts";

const SUPPORT_LABELS = {
  INTERNAL_INVOICE: "internal_invoice",
  DECLARED_EXCEPTION: "declared_exception",
} as const;

export function registerShippingGuideMetrics(registry: Registry): ShippingGuideEmissionObserver {
  const reservations = new Counter({
    name: "shipping_guide_reservations_total",
    help: "Guías de remisión reservadas.",
    registers: [registry],
  });
  const recipients = new Counter({
    name: "shipping_guide_recipients_total",
    help: "Destinatarios de las guías de remisión reservadas, por clase de sustento.",
    labelNames: ["support"] as const,
    registers: [registry],
  });
  return {
    reserved(supports) {
      reservations.inc();
      for (const support of supports) recipients.inc({ support: SUPPORT_LABELS[support] });
    },
  };
}

// Métricas de los comprobantes de retención (add-withholding-receipts, design D26): las reservas
// confirmadas y sus retenciones por impuesto, con `income` e `iva` como únicos valores. Sin empresa ni
// comprobante como etiqueta. La transmisión, la autorización y el RIDE usan sus métricas vigentes.
import { Counter, type Registry } from "@prometheus-io/client";
import type { WithholdingEmissionObserver } from "../application/emission.ts";

const TAX_LABELS: Readonly<Record<string, "income" | "iva">> = { "1": "income", "2": "iva" };

export function registerWithholdingMetrics(registry: Registry): WithholdingEmissionObserver {
  const reservations = new Counter({
    name: "withholding_receipt_reservations_total",
    help: "Comprobantes de retención reservados.",
    registers: [registry],
  });
  const items = new Counter({
    name: "withholding_receipt_items_total",
    help: "Retenciones de los comprobantes reservados, por impuesto.",
    labelNames: ["tax"] as const,
    registers: [registry],
  });
  return {
    reserved(taxes) {
      reservations.inc();
      for (const tax of taxes) {
        const label = TAX_LABELS[tax];
        if (label) items.inc({ tax: label });
      }
    },
  };
}

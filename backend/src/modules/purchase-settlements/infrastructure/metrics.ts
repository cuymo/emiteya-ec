// Métricas de las liquidaciones de compra (add-purchase-settlements, design D26): las reservas
// confirmadas, sin empresa ni comprobante como etiqueta. La transmisión, la autorización y el RIDE
// usan sus métricas vigentes.
import { Counter, type Registry } from "@prometheus-io/client";
import type { PurchaseSettlementEmissionObserver } from "../application/emission.ts";

export function registerPurchaseSettlementMetrics(
  registry: Registry,
): PurchaseSettlementEmissionObserver {
  const reservations = new Counter({
    name: "purchase_settlement_reservations_total",
    help: "Liquidaciones de compra reservadas.",
    registers: [registry],
  });
  return { reserved: () => reservations.inc() };
}

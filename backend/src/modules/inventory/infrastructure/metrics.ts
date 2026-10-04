// Métricas del inventario (add-minimal-inventory, design D14): los movimientos registrados por tipo.
// Nunca identificadores de empresa ni de producto como etiqueta.
import { Counter, type Registry } from "@prometheus-io/client";
import type { InventoryObserver } from "../application/ports.ts";

export function registerInventoryMetrics(registry: Registry): InventoryObserver {
  const movements = new Counter({
    name: "inventory_movements_total",
    help: "Movimientos de inventario registrados, por tipo. La salida de una factura se cuenta al registrarla en la transacción de su autorización.",
    labelNames: ["type"] as const,
    registers: [registry],
  });
  return { movement: (type) => movements.inc({ type }) };
}

// Métricas del inventario (add-minimal-inventory, design D14): los movimientos registrados por tipo y
// los productos con saldo negativo, leídos de la base en cada consulta de las métricas. Nunca
// identificadores de empresa ni de producto como etiqueta.
import { Counter, Gauge, type Registry } from "@prometheus-io/client";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { InventoryObserver } from "../application/ports.ts";

export function registerInventoryMetrics(
  registry: Registry,
  sources: { prisma: PrismaClient },
): InventoryObserver {
  new Gauge({
    name: "inventory_negative_balances",
    help: "Productos con saldo negativo. Informativo: el saldo negativo está permitido.",
    registers: [registry],
    async collect() {
      this.set(await sources.prisma.stockBalance.count({ where: { balance: { lt: 0 } } }));
    },
  });
  const movements = new Counter({
    name: "inventory_movements_total",
    help: "Movimientos de inventario registrados, por tipo. La salida de una factura se cuenta al registrarla en la transacción de su autorización.",
    labelNames: ["type"] as const,
    registers: [registry],
  });
  return { movement: (type) => movements.inc({ type }) };
}

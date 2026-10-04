// Rutas del inventario bajo /api/v1 (add-minimal-inventory, design D10). No hay rutas para
// recalcular ni fijar el saldo: solo cambia con movimientos.
import { Router, type Response } from "express";
import type { ListMeta, StockItemDetailView, StockItemView } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { Inventory, StockItem } from "../../application/inventory.ts";
import { isNegative, trackingState } from "../../domain/stock.ts";

export function toStockItemView(item: StockItem): StockItemView {
  const { product, inventory } = item;
  const balance = inventory?.stock.balance ?? null;
  return {
    productId: product.id,
    mainCode: product.mainCode,
    auxiliaryCode: product.auxiliaryCode,
    name: product.name,
    productStatus: product.status,
    state: trackingState(product.stockTracked, inventory !== null),
    balance,
    negative: balance !== null && isNegative(balance),
    lastMovementAt: inventory?.lastMovementAt?.toISOString() ?? null,
  };
}

export function toStockItemDetailView(item: StockItem): StockItemDetailView {
  return {
    ...toStockItemView(item),
    initializedAt: item.inventory?.stock.initializedAt.toISOString() ?? null,
    initializedByName: item.inventory?.initializedByName ?? null,
  };
}

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

export function inventoryRouter(inventory: Inventory): Router {
  const router = Router();

  router.post("/inventory/items/:productId/initialization", async (req, res) => {
    const item = await inventory.initialize(contextOf(res), req.params.productId, req.body);
    send(res, 201, toStockItemDetailView(item));
  });

  router.put("/inventory/items/:productId/tracking", async (req, res) => {
    const item = await inventory.setTracking(contextOf(res), req.params.productId, req.body);
    send(res, 200, toStockItemDetailView(item));
  });

  return router;
}

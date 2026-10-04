// Rutas del inventario bajo /api/v1 (add-minimal-inventory, design D10). No hay rutas para
// recalcular ni fijar el saldo: solo cambia con movimientos.
import { Router, type Response } from "express";
import {
  IDEMPOTENCY_KEY_HEADER,
  type ListMeta,
  type StockItemDetailView,
  type StockItemView,
  type StockMovementView,
} from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { Inventory, StockItem, StockListItem } from "../../application/inventory.ts";
import type { MovementView } from "../../application/ports.ts";
import { isNegative, trackingState } from "../../domain/stock.ts";

export function toStockItemView(item: StockListItem): StockItemView {
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

export function toStockMovementView(movement: MovementView): StockMovementView {
  return {
    id: movement.id,
    position: movement.position,
    type: movement.type,
    delta: movement.delta,
    balanceAfter: movement.balanceAfter,
    occurredAt: movement.occurredAt.toISOString(),
    origin: movement.origin,
    actorName: movement.actorName,
    documentId: movement.documentId,
    documentNumber: movement.documentNumber,
    reason: movement.reason,
  };
}

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

export function inventoryRouter(inventory: Inventory): Router {
  const router = Router();

  router.get("/inventory/items", async (req, res) => {
    const { items, meta } = await inventory.list(contextOf(res), req.query);
    send(res, 200, items.map(toStockItemView), meta);
  });

  router.get("/inventory/items/:productId", async (req, res) => {
    const item = await inventory.detail(contextOf(res), req.params.productId);
    send(res, 200, toStockItemDetailView(item));
  });

  router.get("/inventory/items/:productId/movements", async (req, res) => {
    const { items, meta } = await inventory.movements(
      contextOf(res),
      req.params.productId,
      req.query,
    );
    send(res, 200, items.map(toStockMovementView), meta);
  });

  router.post("/inventory/items/:productId/initialization", async (req, res) => {
    const item = await inventory.initialize(contextOf(res), req.params.productId, req.body);
    send(res, 201, toStockItemDetailView(item));
  });

  router.post("/inventory/items/:productId/entries", async (req, res) => {
    const { movement, replayed } = await inventory.entry(
      contextOf(res),
      req.params.productId,
      req.header(IDEMPOTENCY_KEY_HEADER),
      req.body,
    );
    send(res, replayed ? 200 : 201, toStockMovementView(movement));
  });

  router.post("/inventory/items/:productId/adjustments", async (req, res) => {
    const { movement, replayed } = await inventory.adjust(
      contextOf(res),
      req.params.productId,
      req.header(IDEMPOTENCY_KEY_HEADER),
      req.body,
    );
    send(res, replayed ? 200 : 201, toStockMovementView(movement));
  });

  router.put("/inventory/items/:productId/tracking", async (req, res) => {
    const item = await inventory.setTracking(contextOf(res), req.params.productId, req.body);
    send(res, 200, toStockItemDetailView(item));
  });

  return router;
}

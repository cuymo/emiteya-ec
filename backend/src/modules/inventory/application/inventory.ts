// Casos de uso del inventario (add-minimal-inventory, design D7, D8 y D11). La empresa sale siempre
// del contexto de la sesión; un producto de otra empresa responde igual que uno inexistente. La
// inicialización, el control, las entradas y los ajustes toman el lock del control de stock del
// producto, así que no se cruzan entre sí ni con la corrección de su marca.
import {
  canonicalDecimal,
  compareDecimalStrings,
  initializeStockSchema,
  stockTrackingSchema,
} from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import {
  inventoryAlreadyInitialized,
  inventoryNotInitialized,
  productNotFound,
  stockTrackingHasBalance,
  stockTrackingRequired,
} from "./errors.ts";
import {
  StockAlreadyInitializedError,
  type InventoryProduct,
  type InventoryProducts,
  type InventoryUnitOfWork,
  type StockDetail,
  type StockReads,
} from "./ports.ts";
import type { DbClient } from "../../../platform/db/database.ts";

/** Producto con su inventario, si está inicializado. */
export type StockItem = Readonly<{ product: InventoryProduct; inventory: StockDetail | null }>;

export type InventoryDependencies = {
  uow: InventoryUnitOfWork;
  products: InventoryProducts;
  reads: (db: DbClient) => StockReads;
  db: DbClient;
  authorizer: Authorizer;
  now: () => Date;
};

export function createInventory(deps: InventoryDependencies) {
  const { uow, authorizer, now } = deps;

  async function item(
    ctx: RequestContext,
    productId: string,
    action: Parameters<Authorizer["requirePermission"]>[1],
  ): Promise<StockItem> {
    const product = await deps.products(deps.db).find(ctx.companyId, productId);
    if (!product) throw authorizer.missingResource(ctx, action, productNotFound());
    return { product, inventory: await deps.reads(deps.db).detail(ctx.companyId, productId) };
  }

  return {
    /** Inicializa el inventario con su `INICIAL` (design D7): una sola vez en su vida. */
    async initialize(ctx: RequestContext, productId: string, body: unknown): Promise<StockItem> {
      authorizer.requirePermission(ctx, "inventory.initialize");
      const input = parseInput(initializeStockSchema, body);
      try {
        await uow.run(async (scope) => {
          await scope.lockTracking(ctx.companyId, productId);
          const product = await deps.products(scope.db).find(ctx.companyId, productId);
          if (!product) {
            throw authorizer.missingResource(ctx, "inventory.initialize", productNotFound());
          }
          if (product.kind !== "GOOD" || !product.stockTracked) throw stockTrackingRequired();
          if (await scope.stock.find(ctx.companyId, productId)) throw inventoryAlreadyInitialized();
          await scope.stock.initialize({
            companyId: ctx.companyId,
            productId,
            quantity: canonicalDecimal(input.quantity),
            note: input.note,
            actorUserId: ctx.userId,
            at: now(),
          });
          await scope.audit.append({
            companyId: ctx.companyId,
            actor: { type: "USER", userId: ctx.userId },
            action: "inventory.initialized",
            changes: { productId },
            correlationId: ctx.requestId,
          });
        });
      } catch (error) {
        if (error instanceof StockAlreadyInitializedError) throw inventoryAlreadyInitialized();
        throw error;
      }
      return item(ctx, productId, "inventory.initialize");
    },

    /**
     * Activa o desactiva el control de un producto con inventario inicializado (design D7): fijar
     * estado. Desactivar exige saldo cero y no cancela las salidas ya congeladas en facturas
     * emitidas; reactivar continúa el mismo kárdex, sin otro `INICIAL`.
     */
    async setTracking(ctx: RequestContext, productId: string, body: unknown): Promise<StockItem> {
      authorizer.requirePermission(ctx, "inventory.configure");
      const { tracked } = parseInput(stockTrackingSchema, body);
      await uow.run(async (scope) => {
        await scope.lockTracking(ctx.companyId, productId);
        const products = deps.products(scope.db);
        const product = await products.find(ctx.companyId, productId);
        if (!product)
          throw authorizer.missingResource(ctx, "inventory.configure", productNotFound());
        if (!(await scope.stock.find(ctx.companyId, productId))) throw inventoryNotInitialized();
        if (product.stockTracked === tracked) return;
        if (tracked && product.kind !== "GOOD") throw stockTrackingRequired();
        if (!tracked) {
          // El saldo queda bloqueado hasta confirmar: ninguna salida lo cambia entre la
          // comprobación y la desactivación.
          const locked = await scope.stock.lock(ctx.companyId, productId, now());
          if (locked && compareDecimalStrings(locked.balance, "0") !== 0) {
            throw stockTrackingHasBalance(locked.balance);
          }
        }
        await products.setStockTracked(ctx.companyId, productId, tracked, ctx.userId);
        await scope.audit.append({
          companyId: ctx.companyId,
          actor: { type: "USER", userId: ctx.userId },
          action: tracked ? "inventory.tracking_enabled" : "inventory.tracking_disabled",
          changes: { productId, "stockTracked.from": !tracked, "stockTracked.to": tracked },
          correlationId: ctx.requestId,
        });
      });
      return item(ctx, productId, "inventory.configure");
    },
  };
}

export type Inventory = ReturnType<typeof createInventory>;

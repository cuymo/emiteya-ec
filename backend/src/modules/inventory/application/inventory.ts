// Casos de uso del inventario (add-minimal-inventory, design D7, D8 y D11). La empresa sale siempre
// del contexto de la sesión; un producto de otra empresa responde igual que uno inexistente. La
// inicialización, el control, las entradas y los ajustes toman el lock del control de stock del
// producto, así que no se cruzan entre sí ni con la corrección de su marca.
import { createHash } from "node:crypto";
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  canonicalDecimal,
  compareDecimalStrings,
  initializeStockSchema,
  stockAdjustmentSchema,
  stockEntrySchema,
  stockTrackingSchema,
  type StockMovementType,
} from "@facturador/contracts";
import { ConflictError } from "../../../platform/http/errors.ts";
import {
  canonicalJson,
  idempotencyKeyRequired,
} from "../../../platform/idempotency/idempotency.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import {
  inventoryAlreadyInitialized,
  inventoryNotInitialized,
  productNotFound,
  stockTrackingDisabled,
  stockTrackingHasBalance,
  stockTrackingRequired,
} from "./errors.ts";
import {
  StockAlreadyInitializedError,
  StockIdempotencyCollisionError,
  type InventoryObserver,
  type InventoryProduct,
  type InventoryProducts,
  type InventoryUnitOfWork,
  type MovementView,
  type StockDetail,
  type StockIdempotentOperation,
  type StockReads,
  type StockRepository,
  type StoredMovement,
} from "./ports.ts";
import type { DbClient } from "../../../platform/db/database.ts";

/** Producto con su inventario, si está inicializado. */
export type StockItem = Readonly<{ product: InventoryProduct; inventory: StockDetail | null }>;

/** Movimiento registrado o, en una repetición con la misma clave y la misma solicitud, el mismo. */
export type MovementResult = Readonly<{ movement: MovementView; replayed: boolean }>;

/** Clave de idempotencia de la cabecera; sin ella o con otro formato, `400 IDEMPOTENCY_KEY_REQUIRED`. */
function readMovementKey(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw idempotencyKeyRequired(
      `La cabecera ${IDEMPOTENCY_KEY_HEADER} es obligatoria: identifica el movimiento para no registrarlo dos veces.`,
    );
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw idempotencyKeyRequired(
      `La cabecera ${IDEMPOTENCY_KEY_HEADER} debe tener de 1 a 100 caracteres ASCII visibles.`,
    );
  }
  return value;
}

const keyReused = () =>
  new ConflictError(
    "IDEMPOTENCY_KEY_REUSED",
    "Esta clave de idempotencia ya se usó con otro movimiento. Genera una clave nueva para registrar otro.",
  );

/** Huella canónica de la solicitud (design D7): la operación y los datos funcionales exactos. */
const requestHash = (operation: StockIdempotentOperation, request: object): string =>
  createHash("sha256")
    .update(canonicalJson({ ...request, operation }))
    .digest("hex");

type ManualMovement = Readonly<{
  operation: StockIdempotentOperation;
  type: Extract<StockMovementType, "ENTRADA_MANUAL" | "AJUSTE">;
  key: string;
  delta: string;
  reason: string | null;
  /** Datos funcionales de la huella. */
  request: Readonly<Record<string, string | null>>;
}>;

export type InventoryDependencies = {
  uow: InventoryUnitOfWork;
  products: InventoryProducts;
  stock: (db: DbClient) => StockRepository;
  reads: (db: DbClient) => StockReads;
  db: DbClient;
  authorizer: Authorizer;
  now: () => Date;
  observer?: InventoryObserver;
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

  async function view(ctx: RequestContext, movement: StoredMovement): Promise<MovementView> {
    return (
      (await deps.reads(deps.db).movement(ctx.companyId, movement.id)) ?? {
        ...movement,
        actorName: null,
      }
    );
  }

  /**
   * Entrada o ajuste con su clave (design D7). Dentro del lock del producto, la misma clave con la
   * misma huella devuelve el movimiento ya registrado y con otra se rechaza. Un choque con otra
   * solicitud simultánea de otro producto se resuelve releyendo la ganadora.
   */
  async function recordManual(
    ctx: RequestContext,
    productId: string,
    permission: "inventory.entry" | "inventory.adjust",
    input: ManualMovement,
  ): Promise<MovementResult> {
    const hash = requestHash(input.operation, input.request);
    const resolve = (existing: StoredMovement) => {
      if (existing.requestHash !== hash) throw keyReused();
      return existing;
    };
    let outcome: { movement: StoredMovement; replayed: boolean };
    try {
      outcome = await uow.run(async (scope) => {
        await scope.lockTracking(ctx.companyId, productId);
        const product = await deps.products(scope.db).find(ctx.companyId, productId);
        if (!product) throw authorizer.missingResource(ctx, permission, productNotFound());
        const existing = await scope.stock.findByIdempotency(
          ctx.companyId,
          input.operation,
          input.key,
        );
        if (existing) return { movement: resolve(existing), replayed: true };
        if (!(await scope.stock.find(ctx.companyId, productId))) throw inventoryNotInitialized();
        if (!product.stockTracked) throw stockTrackingDisabled();
        const movement = await scope.stock.append({
          companyId: ctx.companyId,
          productId,
          type: input.type,
          delta: input.delta,
          origin: "USER",
          actorUserId: ctx.userId,
          reason: input.reason,
          idempotency: { operation: input.operation, key: input.key, requestHash: hash },
          occurredAt: now(),
        });
        return { movement, replayed: false };
      });
    } catch (error) {
      if (!(error instanceof StockIdempotencyCollisionError)) throw error;
      const winner = await deps
        .stock(deps.db)
        .findByIdempotency(ctx.companyId, input.operation, input.key);
      if (!winner) throw error;
      outcome = { movement: resolve(winner), replayed: true };
    }
    if (!outcome.replayed) deps.observer?.movement(input.type);
    return { movement: await view(ctx, outcome.movement), replayed: outcome.replayed };
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
      deps.observer?.movement("INICIAL");
      return item(ctx, productId, "inventory.initialize");
    },

    /** Entrada manual: incremento positivo de existencias (design D7). */
    async entry(
      ctx: RequestContext,
      productId: string,
      key: unknown,
      body: unknown,
    ): Promise<MovementResult> {
      authorizer.requirePermission(ctx, "inventory.entry");
      const idempotencyKey = readMovementKey(key);
      const input = parseInput(stockEntrySchema, body);
      const quantity = canonicalDecimal(input.quantity);
      return recordManual(ctx, productId, "inventory.entry", {
        operation: "inventory.entry",
        type: "ENTRADA_MANUAL",
        key: idempotencyKey,
        delta: quantity,
        reason: input.note,
        request: { productId, quantity, note: input.note },
      });
    },

    /** Ajuste: corrección administrativa, positiva o negativa, con motivo (design D7). */
    async adjust(
      ctx: RequestContext,
      productId: string,
      key: unknown,
      body: unknown,
    ): Promise<MovementResult> {
      authorizer.requirePermission(ctx, "inventory.adjust");
      const idempotencyKey = readMovementKey(key);
      const input = parseInput(stockAdjustmentSchema, body);
      const delta = canonicalDecimal(input.delta);
      return recordManual(ctx, productId, "inventory.adjust", {
        operation: "inventory.adjust",
        type: "AJUSTE",
        key: idempotencyKey,
        delta,
        reason: input.reason,
        request: { productId, delta, reason: input.reason },
      });
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

// Puertos del inventario (add-minimal-inventory, design D1, D2 y D7). La aplicación no conoce
// Prisma: el repositorio y la unidad de trabajo los implementa la infraestructura.
import type { StockMovementOrigin, StockMovementType } from "@facturador/contracts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { MovementRange } from "../domain/stock.ts";

/** Operaciones con clave de idempotencia; junto con la empresa y la clave forman su alcance. */
export const STOCK_IDEMPOTENT_OPERATIONS = ["inventory.entry", "inventory.adjust"] as const;
export type StockIdempotentOperation = (typeof STOCK_IDEMPOTENT_OPERATIONS)[number];

/** Inventario inicializado de un producto: su saldo materializado. */
export type StoredStock = Readonly<{
  companyId: string;
  productId: string;
  balance: string;
  lastPosition: number;
  initializedAt: Date;
  initializedBy: string;
  updatedAt: Date;
}>;

export type StoredMovement = Readonly<{
  id: string;
  companyId: string;
  productId: string;
  position: number;
  type: StockMovementType;
  delta: string;
  balanceAfter: string;
  documentId: string | null;
  documentNumber: string | null;
  origin: StockMovementOrigin;
  actorUserId: string | null;
  reason: string | null;
  idempotencyOperation: StockIdempotentOperation | null;
  idempotencyKey: string | null;
  requestHash: string | null;
  occurredAt: Date;
}>;

export type MovementIdempotency = Readonly<{
  operation: StockIdempotentOperation;
  key: string;
  requestHash: string;
}>;

/** Movimiento que se agrega al kárdex; la posición y el saldo resultante los fija el saldo. */
export type NewMovement = Readonly<{
  companyId: string;
  productId: string;
  type: Exclude<StockMovementType, "INICIAL">;
  delta: string;
  origin: StockMovementOrigin;
  actorUserId: string | null;
  documentId?: string;
  documentNumber?: string;
  reason?: string | null;
  idempotency?: MovementIdempotency;
  occurredAt: Date;
}>;

export type Initialization = Readonly<{
  companyId: string;
  productId: string;
  quantity: string;
  note: string | null;
  actorUserId: string;
  at: Date;
}>;

/** El producto no tiene inventario inicializado: no hay saldo al que agregar un movimiento. */
export class StockNotInitializedError extends Error {
  readonly productId: string;

  constructor(productId: string) {
    super(`el producto ${productId} no tiene inventario inicializado`);
    this.name = "StockNotInitializedError";
    this.productId = productId;
  }
}

/** Otra transacción confirmó antes la inicialización del mismo producto. */
export class StockAlreadyInitializedError extends Error {
  readonly productId: string;

  constructor(productId: string) {
    super(`el inventario del producto ${productId} ya está inicializado`);
    this.name = "StockAlreadyInitializedError";
    this.productId = productId;
  }
}

/** Otra transacción confirmó antes un movimiento con la misma empresa, operación y clave. */
export class StockIdempotencyCollisionError extends Error {
  constructor() {
    super("La clave de idempotencia del movimiento ya está registrada.");
    this.name = "StockIdempotencyCollisionError";
  }
}

/**
 * El retorno físico de una nota supera lo que queda de la salida de la factura para el producto
 * (add-credit-notes, design D10). Su `code` es el que espera el puerto de `credit-notes`.
 */
export class StockReturnExceededError extends Error {
  readonly code = "STOCK_RETURN_EXCEEDED";
  readonly productId: string;

  constructor(productId: string) {
    super(`el retorno físico del producto ${productId} supera su salida`);
    this.name = "StockReturnExceededError";
    this.productId = productId;
  }
}

export interface StockRepository {
  find(companyId: string, productId: string): Promise<StoredStock | null>;
  findMany(
    companyId: string,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredStock>>;
  /** El saldo y su `INICIAL` (posición 1), dentro de la transacción del llamador. */
  initialize(input: Initialization): Promise<StoredMovement>;
  /**
   * Suma la variación al saldo con una actualización atómica, que bloquea su fila hasta el fin de
   * la transacción, y agrega el movimiento con la posición y el saldo resultantes.
   */
  append(movement: NewMovement): Promise<StoredMovement>;
  /** Bloquea el saldo con una actualización atómica y lo devuelve; null sin inicializar. */
  lock(companyId: string, productId: string, at: Date): Promise<StoredStock | null>;
  findOutflow(
    companyId: string,
    documentId: string,
    productId: string,
  ): Promise<StoredMovement | null>;
  findByIdempotency(
    companyId: string,
    operation: StockIdempotentOperation,
    key: string,
  ): Promise<StoredMovement | null>;
  /** Productos con inventario inicializado de la empresa; con `negative`, solo los de saldo menor que cero. */
  initializedIds(companyId: string, options?: { negative?: boolean }): Promise<string[]>;
}

export type InventoryScope = Readonly<{
  db: DbClient;
  stock: StockRepository;
  audit: AuditLog;
  /**
   * Lock transaccional del control de stock de un producto (design D7): serializa la
   * inicialización, el control, las entradas, los ajustes y la corrección de la marca.
   */
  lockTracking(companyId: string, productId: string): Promise<void>;
}>;

export interface InventoryUnitOfWork {
  run<T>(work: (scope: InventoryScope) => Promise<T>): Promise<T>;
}

/** Producto visto por el inventario: lo implementa la lectura exportada de `products`. */
export type InventoryProduct = Readonly<{
  id: string;
  mainCode: string | null;
  auxiliaryCode: string | null;
  name: string;
  kind: "GOOD" | "SERVICE";
  status: "ACTIVE" | "INACTIVE";
  stockTracked: boolean;
}>;

/**
 * Página de productos de la lista (design D8): por la marca y por los identificadores que aporta el
 * inventario. `orIds` suma esos productos a los que cumplen la marca.
 */
export type InventoryProductQuery = Readonly<{
  search?: string | undefined;
  stockTracked?: boolean;
  onlyIds?: readonly string[];
  excludeIds?: readonly string[];
  orIds?: readonly string[];
  page: number;
  pageSize: number;
}>;

/**
 * Productos sobre el cliente de la transacción (design D1, D7 y D8): la lectura, la página de la
 * lista y el cambio de la marca de control de stock de un producto con inventario inicializado, que
 * pertenecen a `products`.
 */
export type InventoryProducts = (db: DbClient) => {
  find(companyId: string, productId: string): Promise<InventoryProduct | null>;
  search(
    companyId: string,
    query: InventoryProductQuery,
  ): Promise<{ items: InventoryProduct[]; total: number }>;
  setStockTracked(
    companyId: string,
    productId: string,
    stockTracked: boolean,
    userId: string,
  ): Promise<boolean>;
};

/** Inventario de un producto con el momento de su último movimiento. */
export type StockSummary = Readonly<{ stock: StoredStock; lastMovementAt: Date | null }>;

/** Inventario de un producto con la persona que lo inicializó y su último movimiento. */
export type StockDetail = StockSummary & Readonly<{ initializedByName: string }>;

/** Movimiento con el nombre de su actor, para la API (design D8). */
export type MovementView = StoredMovement & Readonly<{ actorName: string | null }>;

/** Lecturas del inventario para la API (design D8). */
export interface StockReads {
  detail(companyId: string, productId: string): Promise<StockDetail | null>;
  /** Saldos de una página de productos, en una consulta, con su último movimiento en otra. */
  summaries(
    companyId: string,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, StockSummary>>;
  movement(companyId: string, movementId: string): Promise<MovementView | null>;
  /** Kárdex de un producto en el rango, por posición descendente. */
  movements(
    companyId: string,
    productId: string,
    query: Readonly<{ range: MovementRange; page: number; pageSize: number }>,
  ): Promise<{ items: MovementView[]; total: number }>;
}

/** Métricas del inventario (design D14): cada movimiento registrado, por tipo. */
export type InventoryObserver = Readonly<{
  movement(type: StockMovementType): void;
}>;

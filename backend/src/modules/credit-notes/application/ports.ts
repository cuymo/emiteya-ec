// Puertos del módulo credit-notes (add-credit-notes, design D1, D3, D7 y D10). La infraestructura
// los implementa con Prisma; las lecturas de `invoices` y la capacidad devolvible de `inventory` se
// inyectan desde `main.ts`, de modo que ningún módulo de los que la nota lee la importa.
import type { CreditNoteCause } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { CreditedLine } from "../domain/amounts.ts";

/** Una línea de la capacidad acreditable: la cantidad original y lo reservado y aplicado. */
export type CapacityLine = Readonly<{
  position: number;
  productId: string;
  original: string;
  reserved: string;
  applied: string;
}>;

/** Capacidad acreditable vigente de una factura; sin fila todavía, todo en cero. */
export type CreditCapacityState = Readonly<{
  exists: boolean;
  reserved: string;
  applied: string;
  lines: readonly CapacityLine[];
  /** Las líneas de las notas vigentes (reservadas y aplicadas): lo acreditado vigente (D6). */
  credited: readonly CreditedLine[];
}>;

export type CreditReservationLineInput = Readonly<{
  position: number;
  quantity: string;
  subtotal: string;
  discount: string;
  taxableBase: string;
  taxes: readonly Readonly<{
    taxCode: string;
    rateCode: string;
    percentage: string;
    base: string;
    amount: string;
  }>[];
  physicalReturn: string;
}>;

export type CreditOutcome = "APPLIED" | "RELEASED";

/** La capacidad excedida que rechazó la base: importe de la factura o cantidad de una línea. */
export class CreditCapacityExceededError extends Error {
  readonly kind: "AMOUNT" | "QUANTITY";
  constructor(kind: "AMOUNT" | "QUANTITY") {
    super(`CREDIT_CAPACITY_EXCEEDED: ${kind}`);
    this.name = "CreditCapacityExceededError";
    this.kind = kind;
  }
}

/**
 * Capacidad acreditable de las facturas (design D7 y D8), sobre la transacción del llamador. La
 * reserva suma a la capacidad antes del secuencial y escribe las filas de la nota después de crearla;
 * los triggers diferidos exigen al confirmar que ambas coincidan.
 */
export interface CreditCapacityRepository {
  /** Bloqueo transaccional de la capacidad de la factura, antes de leer lo acreditado vigente. */
  lock(companyId: string, invoiceId: string): Promise<void>;
  /** Crea la capacidad desde el snapshot de la factura si falta; idempotente. */
  initialize(input: {
    companyId: string;
    invoiceId: string;
    total: string;
    lines: readonly Readonly<{ position: number; productId: string; quantity: string }>[];
  }): Promise<void>;
  read(companyId: string, invoiceId: string): Promise<CreditCapacityState>;
  /** Suma el importe y las cantidades a lo reservado; un exceso lanza `CreditCapacityExceededError`. */
  reserve(input: {
    companyId: string;
    invoiceId: string;
    amount: string;
    lines: readonly Readonly<{ position: number; quantity: string }>[];
  }): Promise<void>;
  /** Escribe la reserva de la nota y sus líneas acreditadas, ya creada la nota. */
  record(input: {
    companyId: string;
    invoiceId: string;
    creditNoteId: string;
    cause: CreditNoteCause;
    amount: string;
    lines: readonly CreditReservationLineInput[];
  }): Promise<void>;
  /**
   * Aplica o libera la reserva de la nota con una actualización guardada por estado, y mueve el
   * importe y las cantidades en la capacidad. false si la reserva ya no estaba `RESERVED`: una
   * repetición no aplica ni libera dos veces.
   */
  conclude(
    companyId: string,
    creditNoteId: string,
    outcome: CreditOutcome,
    at: Date,
  ): Promise<boolean>;
}

/** Retorno físico de una nota para un producto de la factura. */
export type ProductReturn = Readonly<{ productId: string; quantity: string }>;

/** Código del error con que la capacidad devolvible rechaza un exceso (design D10). */
export const STOCK_RETURN_EXCEEDED = "STOCK_RETURN_EXCEEDED";

/**
 * Capacidad devolvible de las facturas por producto (design D10), sobre la transacción del
 * llamador. La implementa `inventory` y la compone `main.ts`: `credit-notes` no importa
 * `inventory`. Es independiente de la capacidad acreditable.
 */
export type ReturnCapacity = (db: DbClient) => {
  /** Disponible por producto: la salida original menos lo aplicado y reservado; cero sin salida. */
  available(
    companyId: string,
    invoiceId: string,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
  /**
   * Suma los retornos a lo reservado, por producto en orden estable; un exceso lanza un error con
   * `code` igual a `STOCK_RETURN_EXCEEDED`.
   */
  reserve(input: {
    companyId: string;
    invoiceId: string;
    returns: readonly ProductReturn[];
  }): Promise<void>;
  /** Escribe las reservas devolvibles de la nota, ya creada la nota. */
  record(input: {
    companyId: string;
    invoiceId: string;
    creditNoteId: string;
    returns: readonly ProductReturn[];
  }): Promise<void>;
};

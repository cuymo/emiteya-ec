// Puertos del módulo credit-notes (add-credit-notes, design D1, D3, D7 y D10). La infraestructura
// los implementa con Prisma; las lecturas de `invoices` y la capacidad devolvible de `inventory` se
// inyectan desde `main.ts`, de modo que ningún módulo de los que la nota lee la importa.
import type { CreditNoteCause } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { IdempotencyStore } from "../../../platform/idempotency/idempotency.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { DocumentReservationScope } from "../../fiscal/application/document-reservation.ts";
import type { SchemaRegistryEntry } from "../../sri-engine/application/schemas.ts";
import type { CreditedLine } from "../domain/amounts.ts";
import type { IssuerConfig, IssuerPoint, SourceInvoice } from "../domain/build-snapshot.ts";
import type { CreditNoteDraftContent, CreditNoteDraftRecord } from "../domain/draft.ts";

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

/**
 * Factura de origen tal como la lee la nota (design D3): la lectura `invoiceCreditSource` de
 * `invoices`, inyectada por `main.ts`. La integridad del snapshot y de sus artefactos viene comprobada.
 */
export type CreditSource = Omit<SourceInvoice, "authorization"> &
  Readonly<{
    state: string;
    authorization: Readonly<{ number: string; date: Date; environment: string }> | null;
    consumerFinal: boolean;
    totals: Readonly<{ total: string }>;
    integrity: Readonly<{ intact: boolean; problems: readonly string[] }>;
  }>;

export type InvoiceCreditSourceReader = (db: DbClient) => {
  find(companyId: string, invoiceId: string): Promise<CreditSource | null>;
};

/** Lecturas de la preparación de la empresa para emitir, sobre un cliente (design D4). */
export type CreditNotesReads = {
  currentConfig(companyId: string): Promise<IssuerConfig | null>;
  emissionPoint(
    companyId: string,
    emissionPointId: string,
  ): Promise<(IssuerPoint & Readonly<{ available: boolean }>) | null>;
  activeCertificate(companyId: string): Promise<Readonly<{ usable: boolean }> | null>;
  schemaRegistry(): Promise<readonly SchemaRegistryEntry[]>;
  datasetVersions(): Promise<Readonly<Record<string, number>>>;
};

/** Línea guardada del borrador: con la cantidad resuelta, también la original de una anulación. */
export type StoredDraftContent = Omit<CreditNoteDraftContent, "lines"> &
  Readonly<{
    lines: readonly Readonly<{ position: number; quantity: string; physicalReturn: string }>[];
  }>;

export interface CreditNoteDraftRepository {
  create(
    companyId: string,
    invoiceId: string,
    content: StoredDraftContent,
    userId: string,
  ): Promise<CreditNoteDraftRecord>;
  find(companyId: string, draftId: string): Promise<CreditNoteDraftRecord | null>;
  /** Borradores `DRAFT` por última actualización, del más reciente al más antiguo. */
  list(
    companyId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: CreditNoteDraftRecord[]; total: number }>;
  /** Reemplaza el contenido solo si sigue `DRAFT` con esa versión; true si lo cambió. */
  updateIfVersion(
    companyId: string,
    draftId: string,
    expectedVersion: number,
    content: StoredDraftContent,
    userId: string,
  ): Promise<boolean>;
  /** Elimina el borrador solo si sigue `DRAFT`; true si lo eliminó. */
  deleteIfDraft(companyId: string, draftId: string): Promise<boolean>;
}

export interface CreditNoteDraftsUnitOfWork {
  run<T>(work: (scope: { drafts: CreditNoteDraftRepository }) => Promise<T>): Promise<T>;
}

/** Facturas elegibles para una nota: autorizadas, sin consumidor final y con capacidad. */
export type EligibleInvoice = Readonly<{
  id: string;
  documentNumber: string;
  issueDate: string;
  buyerIdentification: string;
  buyerName: string;
  total: string;
  available: string;
}>;

export interface EligibleInvoiceReader {
  list(
    companyId: string,
    query: { search?: string | undefined; page: number; pageSize: number },
  ): Promise<{ items: EligibleInvoice[]; total: number }>;
}

/**
 * Operaciones de la transacción de `RESERVED` de una nota (design D4), todas sobre la misma
 * transacción: sin I/O externo ni XML.
 */
export type CreditNoteEmissionScope = DocumentReservationScope & {
  /** Bloquea el borrador `DRAFT` de la empresa: serializa sus emisiones. */
  lockDraft(companyId: string, draftId: string): Promise<CreditNoteDraftRecord | null>;
  markDraftEmitted(
    companyId: string,
    draftId: string,
    documentId: string,
    userId: string,
  ): Promise<void>;
  /** Lock advisory de la configuración de la empresa, como la emisión de la factura. */
  lockConfiguration(companyId: string): Promise<void>;
  reads: CreditNotesReads;
  invoices: ReturnType<InvoiceCreditSourceReader>;
  capacity: CreditCapacityRepository;
  returns: ReturnType<ReturnCapacity>;
  idempotency: IdempotencyStore;
  audit: AuditLog;
};

export interface CreditNoteEmissionUnitOfWork {
  run<T>(work: (scope: CreditNoteEmissionScope) => Promise<T>): Promise<T>;
}

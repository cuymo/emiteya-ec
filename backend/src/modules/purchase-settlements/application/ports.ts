// Puertos del módulo purchase-settlements (add-purchase-settlements, design D1, D3, D12, D13 y D25).
// La infraestructura los implementa con Prisma y con las lecturas internas de taxpayer, catalogs y
// signing; las lecturas de terceros (`parties`) y de productos (`products`) se inyectan desde
// `main.ts`, de modo que ningún módulo importa `purchase-settlements` y este no importa `parties`,
// `products`, `invoices` ni `inventory`. La liquidación no tiene puertos de inventario, capacidades,
// compras ni retenciones: no los toca (design D2).
import type { FiscalCatalogType, InvoiceState } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { IdempotencyStore } from "../../../platform/idempotency/idempotency.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { DocumentReservationScope } from "../../fiscal/application/document-reservation.ts";
import type { StoredDocument } from "../../fiscal/application/ports.ts";
import type { SchemaRegistryEntry } from "../../sri-engine/application/schemas.ts";
import type { IssuerConfig, IssuerPoint } from "../domain/build-snapshot.ts";
import type {
  PurchaseSettlementDraftContent,
  PurchaseSettlementDraftRecord,
} from "../domain/draft.ts";
import type { CatalogOption, PurchaseProduct, PurchaseSupplier } from "../domain/evaluation.ts";

/**
 * Terceros de la empresa para la liquidación (design D4), de `parties`, sobre un cliente: la
 * conexión o la transacción de la reserva. `searchSuppliers` devuelve los activos con el rol de
 * proveedor, sin el consumidor final, con cualquier identificación: la elegibilidad la decide la
 * liquidación. Nunca asigna roles.
 */
export type PurchaseSupplierReader = (db: DbClient) => {
  find(companyId: string, partyId: string): Promise<PurchaseSupplier | null>;
  searchSuppliers(
    companyId: string,
    query: Readonly<{ search?: string | undefined; page: number; pageSize: number }>,
  ): Promise<{ items: PurchaseSupplier[]; total: number }>;
};

/** Productos de la empresa (design D6), de `products`: solo sugieren el código y el nombre. */
export type PurchaseProductReader = (db: DbClient) => {
  find(companyId: string, productId: string): Promise<PurchaseProduct | null>;
};

/** Lecturas de la preparación de la empresa y de los catálogos, sobre un cliente (design D13). */
export type PurchaseSettlementReads = {
  currentConfig(companyId: string): Promise<IssuerConfig | null>;
  emissionPoint(
    companyId: string,
    emissionPointId: string,
  ): Promise<(IssuerPoint & Readonly<{ available: boolean }>) | null>;
  activeCertificate(companyId: string): Promise<Readonly<{ usable: boolean }> | null>;
  schemaRegistry(): Promise<readonly SchemaRegistryEntry[]>;
  datasetVersions(): Promise<Readonly<Record<string, number>>>;
  /**
   * Disponibilidad de un catálogo para la empresa en la fecha, del resolver de `catalogs`: versión
   * aplicable, habilitación y si es utilizable (design D7 y D9).
   */
  availability(
    companyId: string,
    catalogType: FiscalCatalogType,
    date: string,
  ): Promise<ReadonlyMap<string, CatalogOption>>;
};

export interface PurchaseSettlementDraftRepository {
  create(
    companyId: string,
    content: PurchaseSettlementDraftContent,
    userId: string,
  ): Promise<PurchaseSettlementDraftRecord>;
  find(companyId: string, draftId: string): Promise<PurchaseSettlementDraftRecord | null>;
  /** Borradores `DRAFT` por última actualización, del más reciente al más antiguo. */
  list(
    companyId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: PurchaseSettlementDraftRecord[]; total: number }>;
  /** Reemplaza el contenido solo si sigue `DRAFT` con esa versión; true si lo cambió. */
  updateIfVersion(
    companyId: string,
    draftId: string,
    expectedVersion: number,
    content: PurchaseSettlementDraftContent,
    userId: string,
  ): Promise<boolean>;
  /** Elimina el borrador solo si sigue `DRAFT`; true si lo eliminó. */
  deleteIfDraft(companyId: string, draftId: string): Promise<boolean>;
}

export interface PurchaseSettlementDraftsUnitOfWork {
  run<T>(work: (scope: { drafts: PurchaseSettlementDraftRepository }) => Promise<T>): Promise<T>;
}

/** Registro de una liquidación con sus cuatro declaraciones (design D25), en la reserva. */
export type PurchaseSettlementRecord = Readonly<{
  documentId: string;
  supplierPartyId: string;
  eligibilityCase: string;
  eligibilityPolicy: string;
  policyVersion: number;
  lineCount: number;
  paymentCount: number;
  declarations: readonly Readonly<{
    statementId: string;
    policyVersion: number;
    basis: "USER_DECLARED";
    declaredBy: string;
    declaredAt: Date;
  }>[];
}>;

/**
 * Operaciones de la transacción de `RESERVED` de una liquidación (design D13), todas sobre la misma
 * transacción: sin I/O externo ni XML.
 */
export type PurchaseSettlementEmissionScope = DocumentReservationScope & {
  /** Bloquea el borrador `DRAFT` de la empresa: serializa sus emisiones. */
  lockDraft(companyId: string, draftId: string): Promise<PurchaseSettlementDraftRecord | null>;
  markDraftEmitted(
    companyId: string,
    draftId: string,
    documentId: string,
    userId: string,
  ): Promise<void>;
  /** Lock advisory de la configuración de la empresa, como la emisión de la factura. */
  lockConfiguration(companyId: string): Promise<void>;
  /** Registra la liquidación y sus declaraciones, ya creado el comprobante (design D25). */
  recordSettlement(companyId: string, record: PurchaseSettlementRecord): Promise<void>;
  reads: PurchaseSettlementReads;
  suppliers: ReturnType<PurchaseSupplierReader>;
  products: ReturnType<PurchaseProductReader>;
  idempotency: IdempotencyStore;
  audit: AuditLog;
  /** Nombre visible de un usuario de la empresa, para "declarado por". */
  userName(companyId: string, userId: string): Promise<string | null>;
};

export interface PurchaseSettlementEmissionUnitOfWork {
  run<T>(work: (scope: PurchaseSettlementEmissionScope) => Promise<T>): Promise<T>;
}

export interface PurchaseSettlementListReader {
  list(
    companyId: string,
    query: {
      search?: string | undefined;
      state?: InvoiceState | undefined;
      page: number;
      pageSize: number;
    },
  ): Promise<{ items: StoredDocument[]; total: number }>;
}

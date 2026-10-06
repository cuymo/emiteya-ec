// Puertos del módulo withholding-receipts (add-withholding-receipts, design D1, D3, D11, D12 y D15).
// La infraestructura los implementa con Prisma y con las lecturas internas de taxpayer, catalogs y
// signing; la lectura de terceros de `parties` se inyecta desde `main.ts`, de modo que ningún módulo
// importa `withholding-receipts` y este no importa `parties`. El comprobante de retención no tiene
// puertos de inventario, de capacidades ni de facturas: no los toca (design D2).
import type { FiscalCatalogType, InvoiceState } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { IdempotencyStore } from "../../../platform/idempotency/idempotency.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { DocumentReservationScope } from "../../fiscal/application/document-reservation.ts";
import type { StoredDocument } from "../../fiscal/application/ports.ts";
import type { SchemaRegistryEntry } from "../../sri-engine/application/schemas.ts";
import type { IssuerConfig, IssuerPoint } from "../domain/build-snapshot.ts";
import type { WithholdingDraftContent, WithholdingDraftRecord } from "../domain/draft.ts";
import type { CatalogOption, CatalogVersion, WithheldSubject } from "../domain/evaluation.ts";

/**
 * Terceros de la empresa que pueden ser sujeto retenido (design D3), de `parties`, sobre un cliente:
 * la conexión o la transacción de la reserva. `searchSuppliers` devuelve solo proveedores activos con
 * los tipos de identificación pedidos, sin el consumidor final.
 */
export type WithheldPartyReader = (db: DbClient) => {
  find(companyId: string, partyId: string): Promise<WithheldSubject | null>;
  searchSuppliers(
    companyId: string,
    query: Readonly<{
      search?: string | undefined;
      identificationTypes: readonly string[];
      page: number;
      pageSize: number;
    }>,
  ): Promise<{ items: WithheldSubject[]; total: number }>;
};

/** Una versión de un código de porcentaje con su vigencia, para las opciones (design D6). */
export type RateVersion = Readonly<{
  entryKey: string;
  code: string;
  officialLabel: string;
  rateKind: string | null;
  percentage: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  usable: boolean;
}>;

/** Lecturas de la preparación de la empresa y de los catálogos, sobre un cliente (design D15). */
export type WithholdingReads = {
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
   * aplicable, clasificación, habilitación y si es utilizable (design D11 y D12).
   */
  availability(
    companyId: string,
    catalogType: FiscalCatalogType,
    date: string,
  ): Promise<ReadonlyMap<string, CatalogOption>>;
  /** La versión de una entrada vigente en una fecha, sin habilitación (design D6). */
  resolve(
    catalogType: FiscalCatalogType,
    entryKey: string,
    date: string,
  ): Promise<CatalogVersion | null>;
  /** Todas las versiones de un catálogo de códigos de porcentaje, con su vigencia. */
  rateVersions(catalogType: "iva-rate" | "ice-rate" | "irbpnr-rate"): Promise<RateVersion[]>;
};

export interface WithholdingDraftRepository {
  create(
    companyId: string,
    content: WithholdingDraftContent,
    userId: string,
  ): Promise<WithholdingDraftRecord>;
  find(companyId: string, draftId: string): Promise<WithholdingDraftRecord | null>;
  /** Borradores `DRAFT` por última actualización, del más reciente al más antiguo. */
  list(
    companyId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: WithholdingDraftRecord[]; total: number }>;
  /** Reemplaza el contenido solo si sigue `DRAFT` con esa versión; true si lo cambió. */
  updateIfVersion(
    companyId: string,
    draftId: string,
    expectedVersion: number,
    content: WithholdingDraftContent,
    userId: string,
  ): Promise<boolean>;
  /** Elimina el borrador solo si sigue `DRAFT`; true si lo eliminó. */
  deleteIfDraft(companyId: string, draftId: string): Promise<boolean>;
}

export interface WithholdingDraftsUnitOfWork {
  run<T>(work: (scope: { drafts: WithholdingDraftRepository }) => Promise<T>): Promise<T>;
}

/** Registro y líneas de un comprobante de retención (design D28), en la transacción de la reserva. */
export type WithholdingReceiptRecord = Readonly<{
  documentId: string;
  partyId: string;
  relatedParty: "SI" | "NO";
  fiscalPeriod: string;
  lines: readonly Readonly<{
    supportPosition: number;
    position: number;
    supportDocumentType: string;
    supportCode: string;
    supportNumber: string;
    supportIssueDate: string;
    tax: "1" | "2";
    withholdingCode: string;
    entryKey: string;
    base: string;
    percentage: string;
    amount: string;
  }>[];
}>;

/**
 * Operaciones de la transacción de `RESERVED` de un comprobante de retención (design D15), todas
 * sobre la misma transacción: sin I/O externo ni XML.
 */
export type WithholdingEmissionScope = DocumentReservationScope & {
  /** Bloquea el borrador `DRAFT` de la empresa: serializa sus emisiones. */
  lockDraft(companyId: string, draftId: string): Promise<WithholdingDraftRecord | null>;
  markDraftEmitted(
    companyId: string,
    draftId: string,
    documentId: string,
    userId: string,
  ): Promise<void>;
  /** Lock advisory de la configuración de la empresa, como la emisión de la factura. */
  lockConfiguration(companyId: string): Promise<void>;
  /** Registra el comprobante y sus líneas, ya creado el comprobante (design D28). */
  recordReceipt(companyId: string, record: WithholdingReceiptRecord): Promise<void>;
  reads: WithholdingReads;
  parties: ReturnType<WithheldPartyReader>;
  idempotency: IdempotencyStore;
  audit: AuditLog;
  /** Nombre visible de un usuario de la empresa, para "declarado por". */
  userName(companyId: string, userId: string): Promise<string | null>;
};

export interface WithholdingEmissionUnitOfWork {
  run<T>(work: (scope: WithholdingEmissionScope) => Promise<T>): Promise<T>;
}

export interface WithholdingReceiptListReader {
  list(
    companyId: string,
    query: {
      search?: string | undefined;
      state?: InvoiceState | undefined;
      fiscalPeriod?: string | undefined;
      page: number;
      pageSize: number;
    },
  ): Promise<{ items: StoredDocument[]; total: number }>;
}

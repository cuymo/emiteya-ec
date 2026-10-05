// Puertos del módulo debit-notes (add-debit-notes, design D1, D3, D8 y D14). La infraestructura los
// implementa con Prisma; la lectura inmutable de la factura de `invoices` se inyecta desde `main.ts`,
// de modo que ningún módulo de los que la nota lee la importa. La nota de débito no tiene puertos
// de capacidad acreditable ni de inventario: no los toca (design D12).
import type { DebitNoteCause, InvoiceState } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { IdempotencyStore } from "../../../platform/idempotency/idempotency.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { DocumentReservationScope } from "../../fiscal/application/document-reservation.ts";
import type { StoredDocument } from "../../fiscal/application/ports.ts";
import type { SchemaRegistryEntry } from "../../sri-engine/application/schemas.ts";
import type { IssuerConfig, IssuerPoint } from "../domain/build-snapshot.ts";
import type { DebitNoteDraftContent, DebitNoteDraftRecord } from "../domain/draft.ts";
import type { InvoiceLineTax } from "../domain/treatments.ts";

/**
 * Factura de origen tal como la lee la nota (design D3): la lectura `invoiceCreditSource` de
 * `invoices`, sin cambios, inyectada por `main.ts`. La integridad del snapshot y de sus artefactos
 * viene comprobada; la nota nunca lee el producto, el tercero ni el catálogo vigentes.
 */
export type DebitSource = Readonly<{
  id: string;
  documentType: "01";
  documentNumber: string;
  issueDate: string;
  accessKey: string;
  environment: "TEST" | "PRODUCTION";
  state: string;
  authorization: Readonly<{ number: string; date: Date; environment: string }> | null;
  snapshotVersion: number;
  consumerFinal: boolean;
  buyer: Readonly<{
    identificationType: string;
    identification: string;
    legalName: string;
    address: string | null;
  }>;
  lines: readonly Readonly<{ taxes: readonly InvoiceLineTax[] }>[];
  /** Los totales del snapshot; un snapshot sin forma no los tiene y su integridad lo informa. */
  totals: Readonly<{ total: string }> | undefined;
  integrity: Readonly<{ intact: boolean; problems: readonly string[] }>;
}>;

export type InvoiceSourceReader = (db: DbClient) => {
  find(companyId: string, invoiceId: string): Promise<DebitSource | null>;
};

/** Disponibilidad de una forma de pago en una fecha, del resolver de `catalogs` (design D8). */
export type PaymentMethodAvailability = Readonly<{
  entryKey: string;
  usable: boolean;
  applicable: Readonly<{
    id: string;
    code: string;
    officialLabel: string;
    datasetVersion: number;
  }> | null;
}>;

/** Lecturas de la preparación de la empresa para emitir, sobre un cliente (design D4). */
export type DebitNotesReads = {
  currentConfig(companyId: string): Promise<IssuerConfig | null>;
  emissionPoint(
    companyId: string,
    emissionPointId: string,
  ): Promise<(IssuerPoint & Readonly<{ available: boolean }>) | null>;
  activeCertificate(companyId: string): Promise<Readonly<{ usable: boolean }> | null>;
  schemaRegistry(): Promise<readonly SchemaRegistryEntry[]>;
  datasetVersions(): Promise<Readonly<Record<string, number>>>;
  /** Formas de pago del catálogo para la empresa en la fecha: vigencia y habilitación. */
  paymentMethods(
    companyId: string,
    date: string,
  ): Promise<ReadonlyMap<string, PaymentMethodAvailability>>;
};

export interface DebitNoteDraftRepository {
  create(
    companyId: string,
    invoiceId: string,
    content: DebitNoteDraftContent,
    userId: string,
  ): Promise<DebitNoteDraftRecord>;
  find(companyId: string, draftId: string): Promise<DebitNoteDraftRecord | null>;
  /** Borradores `DRAFT` por última actualización, del más reciente al más antiguo. */
  list(
    companyId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: DebitNoteDraftRecord[]; total: number }>;
  /** Reemplaza el contenido solo si sigue `DRAFT` con esa versión; true si lo cambió. */
  updateIfVersion(
    companyId: string,
    draftId: string,
    expectedVersion: number,
    content: DebitNoteDraftContent,
    userId: string,
  ): Promise<boolean>;
  /** Elimina el borrador solo si sigue `DRAFT`; true si lo eliminó. */
  deleteIfDraft(companyId: string, draftId: string): Promise<boolean>;
}

export interface DebitNoteDraftsUnitOfWork {
  run<T>(work: (scope: { drafts: DebitNoteDraftRepository }) => Promise<T>): Promise<T>;
}

/** Factura que admite una nota de débito: autorizada, sin consumidor final y del ambiente vigente. */
export type DebitEligibleInvoice = Readonly<{
  id: string;
  documentNumber: string;
  issueDate: string;
  buyerIdentification: string;
  buyerName: string;
  total: string;
}>;

export interface DebitEligibleInvoiceReader {
  list(
    companyId: string,
    query: {
      search?: string | undefined;
      environment: "TEST" | "PRODUCTION" | null;
      page: number;
      pageSize: number;
    },
  ): Promise<{ items: DebitEligibleInvoice[]; total: number }>;
}

/**
 * Operaciones de la transacción de `RESERVED` de una nota de débito (design D14), todas sobre la
 * misma transacción: sin I/O externo ni XML.
 */
export type DebitNoteEmissionScope = DocumentReservationScope & {
  /** Bloquea el borrador `DRAFT` de la empresa: serializa sus emisiones. */
  lockDraft(companyId: string, draftId: string): Promise<DebitNoteDraftRecord | null>;
  markDraftEmitted(
    companyId: string,
    draftId: string,
    documentId: string,
    userId: string,
  ): Promise<void>;
  /** Lock advisory de la configuración de la empresa, como la emisión de la factura. */
  lockConfiguration(companyId: string): Promise<void>;
  /** Registra la factura que modifica la nota, ya creada (design D26). */
  recordSupport(companyId: string, debitNoteId: string, invoiceId: string): Promise<void>;
  reads: DebitNotesReads;
  invoices: ReturnType<InvoiceSourceReader>;
  idempotency: IdempotencyStore;
  audit: AuditLog;
};

export interface DebitNoteEmissionUnitOfWork {
  run<T>(work: (scope: DebitNoteEmissionScope) => Promise<T>): Promise<T>;
}

export interface DebitNoteListReader {
  list(
    companyId: string,
    query: {
      search?: string | undefined;
      state?: InvoiceState | undefined;
      cause?: DebitNoteCause | undefined;
      page: number;
      pageSize: number;
    },
  ): Promise<{ items: StoredDocument[]; total: number }>;
}

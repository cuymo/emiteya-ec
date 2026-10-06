// Puertos del módulo shipping-guides (add-shipping-guides, design D1, D3, D7 a D9 y D13). La
// infraestructura los implementa con Prisma y con las lecturas internas de taxpayer, catalogs y
// signing; las lecturas de terceros (`parties`), de productos (`products`) y de facturas
// (`invoiceCreditSource` de `invoices`, sin cambiarla) se inyectan desde `main.ts`, de modo que
// ningún módulo importa `shipping-guides` y este no importa `parties`, `products`, `invoices` ni
// `inventory`. La guía no tiene puertos de inventario ni de capacidades: no los toca (P8).
import type { InvoiceState } from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { IdempotencyStore } from "../../../platform/idempotency/idempotency.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { DocumentReservationScope } from "../../fiscal/application/document-reservation.ts";
import type { StoredDocument } from "../../fiscal/application/ports.ts";
import type { SchemaRegistryEntry } from "../../sri-engine/application/schemas.ts";
import type { IssuerConfig, IssuerPoint } from "../domain/build-snapshot.ts";
import type { ShippingGuideDraftContent, ShippingGuideDraftRecord } from "../domain/draft.ts";
import type {
  GuideEstablishment,
  GuideInvoice,
  GuideParty,
  GuideProduct,
} from "../domain/evaluation.ts";

type PageQuery = Readonly<{ search?: string | undefined; page: number; pageSize: number }>;

/**
 * Terceros de la empresa para la guía (design D3 y D7), de `parties`, sobre un cliente: la conexión o
 * la transacción de la reserva. Las búsquedas devuelven solo terceros activos de tipo 04, 05 o 06,
 * sin el consumidor final; la de transportistas, solo los que tienen el rol `CARRIER`.
 */
export type ShippingPartyReader = (db: DbClient) => {
  find(companyId: string, partyId: string): Promise<GuideParty | null>;
  /** El tercero con esa identidad tributaria, única en la empresa (Party). */
  findByIdentity(
    companyId: string,
    identificationType: string,
    identification: string,
  ): Promise<GuideParty | null>;
  searchCarriers(
    companyId: string,
    query: PageQuery,
  ): Promise<{ items: GuideParty[]; total: number }>;
  searchRecipients(
    companyId: string,
    query: PageQuery,
  ): Promise<{ items: GuideParty[]; total: number }>;
};

/** Productos de la empresa (design D9), de `products`, sobre un cliente. */
export type ShippingProductReader = (db: DbClient) => {
  find(companyId: string, productId: string): Promise<GuideProduct | null>;
};

/** Una línea de la factura con sus datos históricos, para las mercancías sugeridas (design D9). */
export type GuideInvoiceLine = Readonly<{
  position: number;
  productId: string;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string;
  quantity: string;
}>;

/**
 * La factura sustento con su comprador, sus líneas y su integridad, tal como la entrega
 * `invoiceCreditSource` (design D8 y D12).
 */
export type GuideInvoiceSource = Omit<GuideInvoice, "intact"> &
  Readonly<{
    integrity: Readonly<{ intact: boolean }>;
    consumerFinal: boolean;
    buyer: Readonly<{ identificationType: string; identification: string; legalName: string }>;
    lines: readonly GuideInvoiceLine[];
  }>;

export type ShippingInvoiceReader = (db: DbClient) => {
  find(companyId: string, invoiceId: string): Promise<GuideInvoiceSource | null>;
};

/** Factura autorizada de la empresa en un ambiente, para elegirla como sustento. */
export type EligibleInvoice = Readonly<{
  id: string;
  documentNumber: string;
  issueDate: string;
  buyerIdentification: string;
  buyerName: string;
  total: string;
}>;

export interface ShippingEligibleInvoiceReader {
  list(
    companyId: string,
    query: PageQuery & Readonly<{ environment: "TEST" | "PRODUCTION" }>,
  ): Promise<{ items: EligibleInvoice[]; total: number }>;
}

/** Lecturas de la preparación de la empresa y de sus establecimientos, sobre un cliente (D13). */
export type ShippingGuideReads = {
  currentConfig(companyId: string): Promise<IssuerConfig | null>;
  emissionPoint(
    companyId: string,
    emissionPointId: string,
  ): Promise<(IssuerPoint & Readonly<{ available: boolean }>) | null>;
  establishment(companyId: string, establishmentId: string): Promise<GuideEstablishment | null>;
  establishments(companyId: string): Promise<readonly GuideEstablishment[]>;
  activeCertificate(companyId: string): Promise<Readonly<{ usable: boolean }> | null>;
  schemaRegistry(): Promise<readonly SchemaRegistryEntry[]>;
  datasetVersions(): Promise<Readonly<Record<string, number>>>;
};

export interface ShippingGuideDraftRepository {
  create(
    companyId: string,
    content: ShippingGuideDraftContent,
    userId: string,
  ): Promise<ShippingGuideDraftRecord>;
  find(companyId: string, draftId: string): Promise<ShippingGuideDraftRecord | null>;
  /** Borradores `DRAFT` por última actualización, del más reciente al más antiguo. */
  list(
    companyId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: ShippingGuideDraftRecord[]; total: number }>;
  /** Reemplaza el contenido solo si sigue `DRAFT` con esa versión; true si lo cambió. */
  updateIfVersion(
    companyId: string,
    draftId: string,
    expectedVersion: number,
    content: ShippingGuideDraftContent,
    userId: string,
  ): Promise<boolean>;
  /** Elimina el borrador solo si sigue `DRAFT`; true si lo eliminó. */
  deleteIfDraft(companyId: string, draftId: string): Promise<boolean>;
}

export interface ShippingGuideDraftsUnitOfWork {
  run<T>(work: (scope: { drafts: ShippingGuideDraftRepository }) => Promise<T>): Promise<T>;
}

/** Registro de una guía y de sus destinatarios (design D26), en la transacción de la reserva. */
export type ShippingGuideRecord = Readonly<{
  documentId: string;
  originEstablishmentId: string | null;
  transporterSource: "SELF" | "PARTY";
  carrierPartyId: string | null;
  carrierIdentificationType: string;
  carrierIdentification: string;
  carrierName: string;
  plate: string;
  transportStart: string;
  transportEnd: string;
  recipientCount: number;
  detailCount: number;
  recipients: readonly Readonly<{
    position: number;
    recipientKind: "PARTY" | "OWN_COMPANY";
    partyId: string | null;
    destinationEstablishmentId: string | null;
    supportKind: "INTERNAL_INVOICE" | "DECLARED_EXCEPTION";
    invoiceId: string | null;
    exceptionCase: string | null;
    exceptionPolicyVersion: number | null;
    declaredBy: string | null;
    declaredAt: Date | null;
    detailCount: number;
  }>[];
}>;

/**
 * Operaciones de la transacción de `RESERVED` de una guía (design D13), todas sobre la misma
 * transacción: sin I/O externo ni XML.
 */
export type ShippingGuideEmissionScope = DocumentReservationScope & {
  /** Bloquea el borrador `DRAFT` de la empresa: serializa sus emisiones. */
  lockDraft(companyId: string, draftId: string): Promise<ShippingGuideDraftRecord | null>;
  markDraftEmitted(
    companyId: string,
    draftId: string,
    documentId: string,
    userId: string,
  ): Promise<void>;
  /** Lock advisory de la configuración de la empresa, como la emisión de la factura. */
  lockConfiguration(companyId: string): Promise<void>;
  /** Registra la guía y sus destinatarios, ya creado el comprobante (design D26). */
  recordGuide(companyId: string, record: ShippingGuideRecord): Promise<void>;
  reads: ShippingGuideReads;
  parties: ReturnType<ShippingPartyReader>;
  products: ReturnType<ShippingProductReader>;
  invoices: ReturnType<ShippingInvoiceReader>;
  idempotency: IdempotencyStore;
  audit: AuditLog;
  /** Nombre visible de un usuario de la empresa, para "declarada por". */
  userName(companyId: string, userId: string): Promise<string | null>;
};

export interface ShippingGuideEmissionUnitOfWork {
  run<T>(work: (scope: ShippingGuideEmissionScope) => Promise<T>): Promise<T>;
}

export interface ShippingGuideListReader {
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

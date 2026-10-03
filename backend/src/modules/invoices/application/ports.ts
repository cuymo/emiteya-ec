// Puertos del módulo invoices (add-invoice-emission, design D1 y D2). La infraestructura los
// implementa con Prisma y con las lecturas internas de los otros módulos; los casos de uso nunca
// importan infraestructura ajena.
import type { ListMeta } from "@facturador/contracts";
import type { SchemaRegistryEntry } from "../../sri-engine/application/schemas.ts";
import type { DraftContent, DraftRecord } from "../domain/draft.ts";
import type {
  AvailabilityLike,
  EvaluationBuyer,
  EvaluationPoint,
  EvaluationPolicy,
  EvaluationProduct,
  IssuerProfile,
} from "../domain/evaluation.ts";

export interface DraftRepository {
  create(companyId: string, content: DraftContent, userId: string): Promise<DraftRecord>;
  find(companyId: string, draftId: string): Promise<DraftRecord | null>;
  /** Borradores `DRAFT` por última actualización, del más reciente al más antiguo. */
  list(
    companyId: string,
    page: { page: number; pageSize: number },
  ): Promise<{ items: DraftRecord[]; total: number }>;
  /** Reemplaza el contenido solo si sigue `DRAFT` con esa versión; true si lo cambió. */
  updateIfVersion(
    companyId: string,
    draftId: string,
    expectedVersion: number,
    content: DraftContent,
    userId: string,
  ): Promise<boolean>;
  /** Elimina el borrador solo si sigue `DRAFT`; true si lo eliminó. */
  deleteIfDraft(companyId: string, draftId: string): Promise<boolean>;
}

export type DraftsScope = { drafts: DraftRepository };

/** Escrituras de borradores en una transacción: el borrador, sus líneas y sus pagos juntos. */
export interface DraftsUnitOfWork {
  run<T>(work: (scope: DraftsScope) => Promise<T>): Promise<T>;
}

/** Configuración tributaria vigente tal como la lee la emisión. */
export type EmissionConfig = Readonly<{
  versionId: string;
  version: number;
  config: Readonly<{ profile: IssuerProfile; environment: "TEST" | "PRODUCTION" }>;
  taxIdentityLocked: boolean;
}>;

export type ActiveCertificateRead = Readonly<{ id: string; fingerprint: string; usable: boolean }>;

/**
 * Lecturas de la evaluación de una factura (design D1 y D6). La vista previa las hace sobre la
 * conexión; la emisión, dentro de su transacción de reserva, con lecturas coherentes.
 */
export type EvaluationReads = {
  currentConfig(companyId: string): Promise<EmissionConfig | null>;
  emissionPoint(companyId: string, emissionPointId: string): Promise<EvaluationPoint | null>;
  activeCertificate(companyId: string): Promise<ActiveCertificateRead | null>;
  party(companyId: string, partyId: string): Promise<EvaluationBuyer | null>;
  product(companyId: string, productId: string): Promise<EvaluationProduct | null>;
  catalogs: CatalogReads;
};

export type CatalogReads = {
  availability(
    companyId: string,
    catalogType: string,
    date: string,
  ): Promise<ReadonlyMap<string, AvailabilityLike>>;
  /** La regla vigente del tipo de identificación en la fecha, o null. */
  identificationRule(code: string, date: string): Promise<unknown>;
  consumerFinalPolicy(date: string): Promise<EvaluationPolicy | null>;
  specialCases(): Promise<readonly Readonly<{ annex: number; topic: string; category: string }>[]>;
  schemaRegistry(): Promise<readonly SchemaRegistryEntry[]>;
};

export type Page<T> = { items: T[]; meta: ListMeta };

// Puertos de la portabilidad (add-data-portability, design D1). Las fuentes son lecturas de solo
// lectura que exportan los módulos dueños y compone main.ts: este módulo no lee tablas. Cada fuente
// expone solo las columnas permitidas (design D6): ninguna lleva secretos de la firma ni datos
// internos de autenticación. Los lotes recorren toda la empresa en un orden total, dentro de la
// transacción de la fase 1; las lecturas por identificador sirven a la fase 2.
import type { DbClient } from "../../../platform/db/database.ts";
import type { CompanyBatches } from "../../../platform/db/report-source.ts";

export type Environment = "TEST" | "PRODUCTION";

export type ConfigVersionRow = Readonly<{
  version: number;
  current: boolean;
  createdAt: Date;
  ruc: string;
  legalName: string;
  tradeName: string | null;
  headOfficeAddress: string;
  phone: string | null;
  email: string | null;
  accountingRequired: boolean;
  specialTaxpayerNumber: string | null;
  withholdingAgentResolution: string | null;
  largeTaxpayer: boolean;
  rimpeCategory: string | null;
  providerRuc: string | null;
  environment: Environment;
  logoAssetId: string | null;
}>;

/** Un logo de la configuración, por su identificador, con lo que lo verifica. */
export type LogoRow = Readonly<{
  assetId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}>;

export type EstablishmentRow = Readonly<{
  id: string;
  code: string;
  address: string;
  active: boolean;
  createdAt: Date;
}>;

export type EmissionPointRow = Readonly<{
  id: string;
  establishmentId: string;
  code: string;
  active: boolean;
  createdAt: Date;
}>;

export type DefaultEmissionPointRow = Readonly<{ userId: string; emissionPointId: string }>;

export type SequenceRow = Readonly<{
  environment: Environment;
  establishmentId: string;
  emissionPointId: string;
  documentType: string;
  nextNumber: number;
  lastReserved: number | null;
  updatedAt: Date;
}>;

export type CatalogSettingRow = Readonly<{
  catalogType: string;
  entryKey: string;
  code: string | null;
  enabled: boolean;
  updatedAt: Date;
  updatedBy: string;
}>;

/** Solo los metadatos de una firma: nunca su archivo, su contraseña ni sus claves. */
export type CertificateRow = Readonly<{
  status: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  fingerprintSha256: string;
  notBefore: Date;
  notAfter: Date;
  detectedRuc: string;
  keyAlgorithm: string;
  keyBits: number;
  uploadedBy: string;
  createdAt: Date;
  replacedAt: Date | null;
}>;

/** Un usuario de la empresa como metadato de la organización (design D5). */
export type UserRow = Readonly<{
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  memberSince: Date;
}>;

export type PartyRow = Readonly<{
  identificationType: string;
  identification: string;
  legalName: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  roles: readonly string[];
  status: string;
  systemRecord: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ProductRow = Readonly<{
  id: string;
  kind: string;
  mainCode: string | null;
  auxiliaryCode: string | null;
  name: string;
  description: string | null;
  unitPrice: string;
  stockTracked: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ProductTaxRow = Readonly<{ productId: string; catalogType: string; entryKey: string }>;

export type StockBalanceRow = Readonly<{
  productId: string;
  balance: string;
  initializedAt: Date;
  updatedAt: Date;
}>;

export type StockMovementRow = Readonly<{
  productId: string;
  position: number;
  movementType: string;
  delta: string;
  balanceAfter: string;
  documentNumber: string | null;
  origin: string;
  actorUserId: string | null;
  reason: string | null;
  occurredAt: Date;
}>;

/** Un evento tal como lo conserva la auditoría: sin IP ni user agent, que no guarda. */
export type AuditEventRow = Readonly<{
  occurredAt: Date;
  actorType: string;
  actorUserId: string | null;
  action: string;
  targetUserId: string | null;
  changes: unknown;
}>;

export type ArtifactRef = Readonly<{
  id: string;
  kind: "SIGNED_XML" | "AUTHORIZED_XML" | "RIDE_PDF";
  sizeBytes: number;
  sha256: string;
}>;

export type ResponseRef = Readonly<{
  attemptId: string;
  attemptNumber: number;
  operation: string;
  contentType: string | null;
  truncated: boolean;
  sizeBytes: number;
  sha256: string;
}>;

/**
 * Un comprobante desde la reserva, con lo que congeló, sus importes por tipo, su autorización y el
 * inventario de sus artefactos y de las respuestas originales de sus intentos con el SRI.
 */
export type DocumentRow = Readonly<{
  id: string;
  environment: Environment;
  documentType: string;
  documentNumber: string;
  accessKey: string;
  issueDate: string;
  state: string;
  counterpartIdentification: string | null;
  counterpartName: string | null;
  recipientCount: number | null;
  subtotal: string | null;
  taxes: string | null;
  total: string | null;
  authorizationNumber: string | null;
  authorizationDate: Date | null;
  snapshotVersion: number | null;
  artifacts: readonly ArtifactRef[];
  responses: readonly ResponseRef[];
  /** Estado del job del RIDE de un comprobante autorizado sin RIDE (pendiente o detenido). */
  rideJobStatus: string | null;
}>;

export type TransitionRow = Readonly<{
  accessKey: string;
  fromState: string | null;
  toState: string;
  cause: string;
  actorType: string;
  actorUserId: string | null;
  occurredAt: Date;
}>;

export type AttemptRow = Readonly<{
  accessKey: string;
  attemptNumber: number;
  operation: string;
  environment: Environment;
  startedAt: Date;
  completedAt: Date;
  transportOutcome: string;
  httpStatus: number | null;
  outcome: string | null;
  messages: unknown;
  response: Readonly<{
    contentType: string | null;
    truncated: boolean;
    sizeBytes: number;
    sha256: string;
  }> | null;
  envelopeSha256: string;
  envelopeSize: number;
  initiatedBy: string | null;
}>;

export type RecipientRow = Readonly<{
  accessKey: string;
  position: number;
  identification: string;
  name: string;
}>;

export type DeliveryRow = Readonly<{
  accessKey: string;
  event: string;
  artifactKind: string;
  artifactSha256: string;
  actorUserId: string;
  occurredAt: Date;
}>;

export type WithholdingLineRow = Readonly<{
  accessKey: string;
  supportPosition: number;
  position: number;
  supportDocumentType: string;
  supportNumber: string;
  supportIssueDate: string;
  tax: string;
  withholdingCode: string;
  base: string;
  percentage: string;
  amount: string;
}>;

/** Bytes conservados con lo que los verifica: la fase 2 los recalcula antes de escribirlos. */
export type StoredBytes = Readonly<{ content: Uint8Array; sizeBytes: number; sha256: string }>;

export type PortabilitySources = Readonly<{
  configVersions: CompanyBatches<ConfigVersionRow>;
  logos: CompanyBatches<LogoRow>;
  establishments: CompanyBatches<EstablishmentRow>;
  emissionPoints: CompanyBatches<EmissionPointRow>;
  defaultEmissionPoints: CompanyBatches<DefaultEmissionPointRow>;
  sequences: CompanyBatches<SequenceRow>;
  catalogSettings: CompanyBatches<CatalogSettingRow>;
  certificates: CompanyBatches<CertificateRow>;
  users: CompanyBatches<UserRow>;
  parties: CompanyBatches<PartyRow>;
  products: CompanyBatches<ProductRow>;
  productTaxes: CompanyBatches<ProductTaxRow>;
  stockBalances: CompanyBatches<StockBalanceRow>;
  stockMovements: CompanyBatches<StockMovementRow>;
  auditEvents: CompanyBatches<AuditEventRow>;
  documents: CompanyBatches<DocumentRow>;
  transitions: CompanyBatches<TransitionRow>;
  attempts: CompanyBatches<AttemptRow>;
  recipients: CompanyBatches<RecipientRow>;
  deliveries: CompanyBatches<DeliveryRow>;
  withholdingLines: CompanyBatches<WithholdingLineRow>;
  readSnapshot(db: DbClient, companyId: string, documentId: string): Promise<unknown>;
  readArtifact(db: DbClient, companyId: string, artifactId: string): Promise<StoredBytes | null>;
  readSriResponse(db: DbClient, companyId: string, attemptId: string): Promise<StoredBytes | null>;
  readLogo(db: DbClient, companyId: string, assetId: string): Promise<StoredBytes | null>;
}>;

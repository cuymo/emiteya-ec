// Puertos del módulo de correo (add-email-delivery, design D1, D8 y D9).
import type {
  DocumentType,
  EmailDeliveryStatus,
  EmailSecurity,
  Environment,
} from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { AuditLog } from "../../audit/application/audit-log.ts";
import type { EmailFailure, EmailFailureCode } from "../domain/failures.ts";
import type { EmailSettingsFields, EmailSettingsRecord } from "../domain/settings.ts";

/** La contraseña SMTP en su sobre AES-256-GCM (design D9). */
export type SealedSmtpPassword = Readonly<{
  formatVersion: number;
  keyVersion: string;
  keyCheck: Buffer;
  wrappedKey: Buffer;
  wrappedKeyNonce: Buffer;
  passwordCiphertext: Buffer;
  passwordNonce: Buffer;
}>;

/** Cifra y abre la contraseña ligada a su empresa; un sobre de otra empresa no se abre. */
export interface SmtpPasswordVault {
  seal(password: string, companyId: string): SealedSmtpPassword;
  /** Lanza `SmtpPasswordUnavailableError` si no se puede abrir. */
  open(sealed: SealedSmtpPassword, companyId: string): string;
}

export class SmtpPasswordUnavailableError extends Error {
  constructor() {
    super("No se pudo abrir la contraseña del servidor de correo.");
    this.name = "SmtpPasswordUnavailableError";
  }
}

export interface EmailSettingsRepository {
  find(companyId: string): Promise<EmailSettingsRecord | null>;
  /** Serializa los cambios de la configuración de una empresa dentro de la transacción. */
  lock(companyId: string): Promise<void>;
  insert(companyId: string, fields: EmailSettingsFields, userId: string): Promise<void>;
  /** Cambia y sube la versión solo si sigue en `expectedVersion`. */
  updateIfVersion(
    companyId: string,
    expectedVersion: number,
    fields: EmailSettingsFields,
    userId: string,
  ): Promise<boolean>;
  findSecret(companyId: string): Promise<SealedSmtpPassword | null>;
  saveSecret(companyId: string, sealed: SealedSmtpPassword): Promise<void>;
  deleteSecret(companyId: string): Promise<void>;
}

export type EmailScope = Readonly<{ settings: EmailSettingsRepository; audit: AuditLog }>;

export interface EmailUnitOfWork {
  run<T>(work: (scope: EmailScope) => Promise<T>): Promise<T>;
}

/** Lo que decide el despliegue (design D5 y D7). */
export type EmailDeploymentPolicy = Readonly<{
  deliveryEnabled: boolean;
  plaintextAllowed: boolean;
}>;

/** Cómo conectar con el servidor de correo de la empresa, con la contraseña ya abierta. */
export type SmtpConnection = Readonly<{
  host: string;
  port: number;
  security: EmailSecurity;
  username: string | null;
  password: string | null;
}>;

export type MailAttachment = Readonly<{ filename: string; contentType: string; content: Buffer }>;

/** Un correo listo para salir (design D4). */
export type OutgoingMail = Readonly<{
  from: Readonly<{ name: string; address: string }>;
  to: readonly string[];
  bcc: string | null;
  subject: string;
  text: string;
  html: string | null;
  attachments: readonly MailAttachment[];
  /** `Message-ID` determinista: un reintento no aparece como otro correo (design D4). */
  messageId: string | null;
}>;

/** Resultado de un envío: aceptado (con las direcciones rechazadas, si hubo) o fallido. */
export type SendOutcome =
  | Readonly<{
      kind: "SENT";
      accepted: readonly string[];
      rejected: readonly Readonly<{ address: string; smtpCode: number | null }>[];
      smtpCode: number | null;
    }>
  | Readonly<{ kind: "FAILED"; failure: EmailFailure }>;

/** Envía un correo por SMTP; nunca lanza por un fallo del servidor: lo devuelve clasificado. */
export interface MailTransport {
  send(connection: SmtpConnection, mail: OutgoingMail): Promise<SendOutcome>;
}

export type DeliveryRecipient = Readonly<{
  address: string;
  /** null mientras el envío no termina. */
  outcome: "ACCEPTED" | "REJECTED" | null;
  reason: string | null;
}>;

/** Un envío de un comprobante (design D8). */
export type EmailDeliveryRecord = Readonly<{
  id: string;
  companyId: string;
  documentId: string;
  origin: "AUTOMATIC" | "MANUAL";
  requestedBy: string | null;
  environment: Environment;
  testRedirect: boolean;
  status: EmailDeliveryStatus;
  recipients: readonly DeliveryRecipient[];
  attemptCount: number;
  failureCode: EmailFailureCode | null;
  failureReason: string | null;
  messageId: string | null;
  createdAt: Date;
  sentAt: Date | null;
  finishedAt: Date | null;
}>;

/** El resultado que cierra o actualiza un envío. */
export type DeliveryUpdate = Readonly<{
  status: EmailDeliveryStatus;
  recipients?: readonly DeliveryRecipient[];
  testRedirect?: boolean;
  failureCode: EmailFailureCode | null;
  failureReason: string | null;
  messageId?: string | null;
  sentAt?: Date | null;
  finishedAt: Date | null;
}>;

export type DeliveryAttempt = Readonly<{
  number: number;
  at: Date;
  outcome: "SENT" | "RETRYABLE" | "DETERMINISTIC";
  smtpCode: number | null;
  detail: string | null;
}>;

export interface EmailDeliveryRepository {
  find(companyId: string, deliveryId: string): Promise<EmailDeliveryRecord | null>;
  /**
   * El envío automático de un comprobante, uno como máximo (índice único parcial): devuelve su id,
   * o null si ya existía. Nunca lanza por el duplicado: corre dentro de la transacción del RIDE.
   */
  createAutomatic(
    input: Readonly<{
      companyId: string;
      documentId: string;
      environment: Environment;
      status: "PENDING" | "DISABLED";
      failureCode: EmailFailureCode | null;
      failureReason: string | null;
      at: Date;
    }>,
  ): Promise<string | null>;
  update(companyId: string, deliveryId: string, update: DeliveryUpdate): Promise<void>;
  /** Un intento de solo agregado y la actualización del envío con su cuenta de intentos. */
  recordAttempt(
    companyId: string,
    deliveryId: string,
    attempt: DeliveryAttempt,
    update: DeliveryUpdate,
  ): Promise<void>;
  /** Los envíos de un comprobante, del más reciente al más antiguo, con sus intentos. */
  listByDocument(companyId: string, documentId: string): Promise<EmailDeliveryHistoryEntry[]>;
  /** Serializa los reenvíos con la misma clave en la empresa, dentro de la transacción. */
  lockIdempotencyKey(companyId: string, key: string): Promise<void>;
  findByIdempotencyKey(
    companyId: string,
    key: string,
  ): Promise<(EmailDeliveryRecord & Readonly<{ requestFingerprint: string | null }>) | null>;
  createManual(
    input: Readonly<{
      companyId: string;
      documentId: string;
      environment: Environment;
      testRedirect: boolean;
      recipients: readonly string[];
      requestedBy: string;
      idempotencyKey: string;
      requestFingerprint: string;
      at: Date;
    }>,
  ): Promise<EmailDeliveryRecord>;
}

/** Un envío con sus intentos y el nombre de quien lo pidió, para su historial (design D10). */
export type EmailDeliveryHistoryEntry = EmailDeliveryRecord &
  Readonly<{
    requesterName: string | null;
    attempts: readonly Readonly<{
      number: number;
      at: Date;
      outcome: DeliveryAttempt["outcome"];
      smtpCode: number | null;
    }>[];
  }>;

/** Un comprobante para su correo, leído por la fuente que exporta `fiscal` (design D1). */
export type DeliverableDocument = Readonly<{
  id: string;
  companyId: string;
  documentType: DocumentType;
  documentNumber: string;
  issueDate: string;
  accessKey: string;
  state: string;
  /** El ambiente del comprobante; el de su autorización, si está autorizado. */
  environment: Environment;
  authorization: Readonly<{ number: string; environment: Environment }> | null;
  issuerName: string;
  receiverName: string | null;
  total: string | null;
  snapshot: unknown;
  /** Solo las notas de crédito y de débito: el snapshot de la factura que modifican. */
  invoiceSnapshot: unknown;
}>;

export type StoredAttachment = Readonly<{ content: Uint8Array; sizeBytes: number; sha256: string }>;

export interface DeliverableDocumentReader {
  find(companyId: string, documentId: string): Promise<DeliverableDocument | null>;
  /** El XML autorizado (o el firmado transmitido, si el SRI no lo devolvió) y el RIDE. */
  attachments(
    companyId: string,
    documentId: string,
  ): Promise<Readonly<{ xml: StoredAttachment | null; ride: StoredAttachment | null }>>;
}

/** Los correos vigentes de cada tercero, leídos por la fuente que exporta `parties`. */
export interface PartyEmailReader {
  emailsOf(
    companyId: string,
    partyIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>>;
}

export type EmailDeliveryScope = Readonly<{
  db: DbClient;
  deliveries: EmailDeliveryRepository;
  audit: AuditLog;
}>;

export interface EmailDeliveryUnitOfWork {
  run<T>(work: (scope: EmailDeliveryScope) => Promise<T>): Promise<T>;
}

/** Métricas del correo (design D13), sin datos de la empresa ni direcciones. */
export type EmailObserver = Readonly<{
  finished(outcome: "sent" | "failed" | "retrying" | "no_recipient" | "disabled"): void;
  sendDuration(seconds: number): void;
}>;

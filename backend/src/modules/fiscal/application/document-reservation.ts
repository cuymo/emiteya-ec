// Reserva de un comprobante fiscal, compartida por tipo (add-credit-notes, design D2). Dentro de la
// transacción de reserva del módulo del tipo, en el orden de add-invoice-emission D7: secuencial,
// identidad tributaria bloqueada, código numérico y clave, comprobante RESERVED y su transición. El
// tipo es un dato: el snapshot y sus columnas los arma el módulo que emite. Sin I/O externo ni XML.
import type { AccessKeys } from "../../sri-engine/application/ports.ts";
import type { Environment } from "../../taxpayer/domain/taxpayer-config.ts";
import type { DocumentType } from "../domain/numbering.ts";
import type { DocumentRepository, StoredDocument } from "./ports.ts";
import type { Reservation, ReservationInput } from "./reservation.ts";

/** Lo que la reserva necesita de la transacción abierta del módulo que emite. */
export type DocumentReservationScope = {
  reserveSequential(input: ReservationInput): Promise<Reservation>;
  /** Bloquea la identidad tributaria; idempotente. */
  lockTaxIdentity(companyId: string): Promise<boolean>;
  documents: DocumentRepository;
};

/** Datos de la reserva que el snapshot guarda en `key`. */
export type DocumentKey = Readonly<{
  documentNumber: string;
  sequential: string;
  numericCode: string;
  emissionType: "1";
  accessKey: string;
}>;

/** Columnas del comprobante que salen de su snapshot. */
export type DocumentColumns = Readonly<{
  schemaVersion: string;
  buyerIdentification: string;
  buyerName: string;
  total: string;
}>;

export type DocumentReservationInput<S> = Readonly<{
  companyId: string;
  documentType: DocumentType;
  /** `YYYY-MM-DD`, capturada una vez antes de la transacción. */
  issueDate: string;
  environment: Environment;
  /** Código del ambiente en la clave (`1` pruebas, `2` producción). */
  environmentCode: "1" | "2";
  ruc: string;
  establishment: Readonly<{ id: string; code: string }>;
  emissionPoint: Readonly<{ id: string; code: string }>;
  reservedBy: string;
  correlationId: string;
  /** El snapshot completo con los datos de la reserva. */
  withKey(key: DocumentKey): S;
  columns(snapshot: S): DocumentColumns;
}>;

export type DocumentReservationResult<S> = Readonly<{
  document: StoredDocument;
  reservation: Reservation;
  snapshot: S;
}>;

export async function reserveDocumentIn<S>(
  scope: DocumentReservationScope,
  accessKeys: AccessKeys,
  input: DocumentReservationInput<S>,
): Promise<DocumentReservationResult<S>> {
  // Secuencial con el ambiente del snapshot.
  const reservation = await scope.reserveSequential({
    companyId: input.companyId,
    environment: input.environment,
    establishmentId: input.establishment.id,
    emissionPointId: input.emissionPoint.id,
    documentType: input.documentType,
    reservedBy: input.reservedBy,
    correlationId: input.correlationId,
  });
  // Identidad tributaria bloqueada.
  await scope.lockTaxIdentity(input.companyId);
  // Código numérico y clave de acceso.
  const sequential = String(reservation.sequential).padStart(9, "0");
  const numericCode = accessKeys.numericCode();
  const accessKey = accessKeys.compose({
    issueDate: input.issueDate,
    documentType: input.documentType,
    ruc: input.ruc,
    environment: input.environmentCode,
    establishment: input.establishment.code,
    emissionPoint: input.emissionPoint.code,
    sequential,
    numericCode,
  });
  const snapshot = input.withKey({
    documentNumber: reservation.documentNumber,
    sequential,
    numericCode,
    emissionType: "1",
    accessKey,
  });
  // Comprobante RESERVED y su transición.
  const document = await scope.documents.insertReserved({
    companyId: input.companyId,
    documentType: input.documentType,
    environment: input.environment,
    establishmentId: input.establishment.id,
    emissionPointId: input.emissionPoint.id,
    documentNumber: reservation.documentNumber,
    sequential: reservation.sequential,
    reservationId: reservation.reservationId,
    accessKey,
    numericCode,
    issueDate: input.issueDate,
    snapshot,
    ...input.columns(snapshot),
    createdBy: input.reservedBy,
  });
  await scope.documents.recordTransition({
    companyId: input.companyId,
    documentId: document.id,
    from: null,
    to: "RESERVED",
    cause: "EMISSION",
    actor: { type: "USER", userId: input.reservedBy },
    metadata: { reservationId: reservation.reservationId, correlationId: input.correlationId },
  });
  return { document, reservation, snapshot };
}

// Historial de entregas observables (add-document-archive, design D9; Q-24): una descarga que la
// aplicación sirvió o una solicitud de impresión del RIDE. Nunca guarda bytes ni afirma que el
// documento se imprimió o que el receptor lo recibió.
import type { ArtifactKind } from "../../domain/document.ts";

export type DeliveryEvent = "DOWNLOAD" | "PRINT_REQUESTED";

export type NewDelivery = Readonly<{
  companyId: string;
  documentId: string;
  event: DeliveryEvent;
  artifactKind: ArtifactKind;
  artifactSha256: string;
  actorUserId: string;
  requestId: string;
}>;

export type StoredDelivery = Readonly<{
  id: string;
  event: DeliveryEvent;
  artifactKind: ArtifactKind;
  actorName: string;
  occurredAt: Date;
}>;

export interface DeliveryRepository {
  record(delivery: NewDelivery): Promise<Readonly<{ id: string; occurredAt: Date }>>;
  /** Las más recientes primero, hasta `limit`, con el total. */
  list(
    companyId: string,
    documentId: string,
    limit: number,
  ): Promise<{ items: StoredDelivery[]; total: number }>;
}

/** Métricas de las entregas (design D14), sin datos de la empresa ni del comprobante. */
export type DeliveryObserver = Readonly<{
  delivered(event: DeliveryEvent): void;
  integrityFailed(kind: ArtifactKind): void;
}>;

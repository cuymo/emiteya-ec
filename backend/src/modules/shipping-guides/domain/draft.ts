// Borrador de una guía de remisión (add-shipping-guides, design D3 a D9): el punto, la partida (un
// establecimiento de origen o un texto), el transportista, la placa, las fechas y los destinatarios
// con su sustento tipado y su detalle. Puede guardarse incompleto; no reserva número. Un borrador
// emitido no cambia.
import type { ShippingExceptionCase } from "@facturador/contracts";

export type ShippingGuideDraftStatus = "DRAFT" | "EMITTED";

export type DraftTransporter =
  Readonly<{ source: "SELF" }> | Readonly<{ source: "PARTY"; partyId: string }>;

export type DraftRecipientRef =
  | Readonly<{ kind: "PARTY"; partyId: string }>
  | Readonly<{ kind: "OWN_COMPANY"; destinationEstablishmentId: string }>;

export type DraftSupport =
  | Readonly<{ kind: "INTERNAL_INVOICE"; invoiceId: string }>
  | Readonly<{ kind: "DECLARED_EXCEPTION"; case: ShippingExceptionCase }>;

export type DraftDetail = Readonly<{
  productId: string | null;
  mainCode: string | null;
  auxiliaryCode: string | null;
  description: string | null;
  quantity: string | null;
}>;

export type DraftRecipient = Readonly<{
  recipient: DraftRecipientRef | null;
  address: string | null;
  motive: string | null;
  route: string | null;
  destinationEstablishmentCode: string | null;
  support: DraftSupport | null;
  details: readonly DraftDetail[];
}>;

/** Contenido que guarda una alta o una corrección, ya validado por el contrato. */
export type ShippingGuideDraftContent = Readonly<{
  emissionPointId: string | null;
  originEstablishmentId: string | null;
  departureAddress: string | null;
  transporter: DraftTransporter | null;
  plate: string | null;
  transportStart: string | null;
  transportEnd: string | null;
  recipients: readonly DraftRecipient[];
}>;

export type ShippingGuideDraftRecord = ShippingGuideDraftContent &
  Readonly<{
    id: string;
    companyId: string;
    status: ShippingGuideDraftStatus;
    documentId: string | null;
    version: number;
    createdAt: Date;
    createdBy: string;
    updatedAt: Date;
    updatedBy: string;
  }>;

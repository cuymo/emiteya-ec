// Vistas de las guías de remisión (add-shipping-guides, design D22): el borrador con su vista previa,
// los terceros de las búsquedas y las facturas elegibles. Sin XML, respuestas originales ni datos
// técnicos.
import type {
  ShippingEligibleInvoiceView,
  ShippingGuideDraftSummaryView,
  ShippingGuideDraftView,
  ShippingRecipientPartyView,
} from "@facturador/contracts";
import type { ShippingGuideDraftDetails } from "../../application/drafts.ts";
import { carrierView } from "../../application/options.ts";
import type { EligibleInvoice } from "../../application/ports.ts";
import type { ShippingGuideDraftRecord } from "../../domain/draft.ts";
import type { GuideParty } from "../../domain/evaluation.ts";

export const toRecipientPartyView = (party: GuideParty): ShippingRecipientPartyView => ({
  id: party.id,
  identificationType: party.identificationType,
  identification: party.identification,
  legalName: party.legalName,
  address: party.address,
});

export const toEligibleInvoiceView = (invoice: EligibleInvoice): ShippingEligibleInvoiceView => ({
  ...invoice,
});

export function toShippingGuideDraftView({
  draft,
  context,
  preview,
}: ShippingGuideDraftDetails): ShippingGuideDraftView {
  const { point, parties, establishments, products, invoices } = context;
  const establishmentRef = (id: string) => {
    const found = establishments.get(id);
    return found ? { id: found.id, code: found.code, address: found.address } : null;
  };
  return {
    id: draft.id,
    version: draft.version,
    emissionPoint: point
      ? {
          id: point.point.id,
          establishmentCode: point.establishment.code,
          code: point.point.code,
          available: point.available,
        }
      : null,
    originEstablishment: draft.originEstablishmentId
      ? establishmentRef(draft.originEstablishmentId)
      : null,
    departureAddress: draft.departureAddress,
    transporter:
      draft.transporter === null
        ? null
        : draft.transporter.source === "SELF"
          ? { source: "SELF" }
          : {
              source: "PARTY",
              partyId: draft.transporter.partyId,
              party: parties.has(draft.transporter.partyId)
                ? carrierView(parties.get(draft.transporter.partyId)!)
                : null,
            },
    plate: draft.plate,
    transportStart: draft.transportStart,
    transportEnd: draft.transportEnd,
    recipients: draft.recipients.map((recipient) => ({
      recipient:
        recipient.recipient === null
          ? null
          : recipient.recipient.kind === "PARTY"
            ? {
                kind: "PARTY",
                partyId: recipient.recipient.partyId,
                party: parties.has(recipient.recipient.partyId)
                  ? toRecipientPartyView(parties.get(recipient.recipient.partyId)!)
                  : null,
              }
            : {
                kind: "OWN_COMPANY",
                destinationEstablishmentId: recipient.recipient.destinationEstablishmentId,
                establishment: establishmentRef(recipient.recipient.destinationEstablishmentId),
              },
      address: recipient.address,
      motive: recipient.motive,
      route: recipient.route,
      destinationEstablishmentCode: recipient.destinationEstablishmentCode,
      support:
        recipient.support === null
          ? null
          : recipient.support.kind === "INTERNAL_INVOICE"
            ? {
                kind: "INTERNAL_INVOICE",
                invoiceId: recipient.support.invoiceId,
                documentNumber: invoices.get(recipient.support.invoiceId)?.documentNumber ?? null,
              }
            : { kind: "DECLARED_EXCEPTION", case: recipient.support.case },
      details: recipient.details.map((detail) => ({
        productId: detail.productId,
        productName: detail.productId ? (products.get(detail.productId)?.name ?? null) : null,
        mainCode: detail.mainCode,
        auxiliaryCode: detail.auxiliaryCode,
        description: detail.description,
        quantity: detail.quantity,
      })),
    })),
    preview,
    createdAt: draft.createdAt.toISOString(),
    createdBy: draft.createdBy,
    updatedAt: draft.updatedAt.toISOString(),
    updatedBy: draft.updatedBy,
  };
}

/** Resumen de un borrador para la lista, sin leer nada más que el borrador. */
export const toShippingGuideDraftSummaryView = (
  draft: ShippingGuideDraftRecord,
  carrierName: string | null,
): ShippingGuideDraftSummaryView => ({
  id: draft.id,
  version: draft.version,
  carrierName,
  recipientCount: draft.recipients.length,
  detailCount: draft.recipients.reduce((sum, recipient) => sum + recipient.details.length, 0),
  transportStart: draft.transportStart,
  updatedAt: draft.updatedAt.toISOString(),
});

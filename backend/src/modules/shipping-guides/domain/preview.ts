// Vista previa de una guía de remisión (add-shipping-guides, design D12 y D22): pura, desde la
// evaluación. Muestra la partida derivada, el transportista resuelto y, por destinatario, la
// identidad, la dirección, el sustento resuelto (la factura con su número, su fecha y su
// autorización, o la excepción con su denominación) y el detalle con sus cantidades canónicas, y
// todos los problemas. No reserva nada.
import { SHIPPING_EXCEPTION_POLICY, type ShippingGuidePreviewView } from "@facturador/contracts";
import type { ShippingGuideEvaluation } from "./evaluation.ts";

export function shippingGuidePreview(
  evaluation: ShippingGuideEvaluation,
  evaluatedOn: string,
): ShippingGuidePreviewView {
  return {
    evaluatedOn,
    departureAddress: evaluation.departureAddress,
    carrier: evaluation.carrier
      ? {
          source: evaluation.carrier.source,
          identificationType: evaluation.carrier.identificationType,
          identification: evaluation.carrier.identification,
          legalName: evaluation.carrier.legalName,
        }
      : null,
    recipients: evaluation.recipients.map((recipient) => ({
      position: recipient.position,
      identification: recipient.identification,
      legalName: recipient.legalName,
      address: recipient.address,
      destinationEstablishmentCode: recipient.destinationEstablishmentCode,
      support:
        recipient.support === null
          ? null
          : recipient.support.kind === "INTERNAL_INVOICE"
            ? {
                kind: "INTERNAL_INVOICE",
                invoice: {
                  id: recipient.support.invoice.id,
                  documentNumber: recipient.support.invoice.documentNumber,
                  issueDate: recipient.support.invoice.issueDate,
                  authorizationNumber: recipient.support.invoice.authorization?.number ?? null,
                },
              }
            : {
                kind: "DECLARED_EXCEPTION",
                case: recipient.support.case,
                label: SHIPPING_EXCEPTION_POLICY[recipient.support.case].label,
              },
      details: recipient.details.map((detail) => ({ ...detail })),
    })),
    counts: { ...evaluation.counts },
    exceptionDeclarationRequired: evaluation.exceptionDeclarationRequired,
    issues: [...evaluation.issues],
  };
}

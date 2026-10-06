// Proyección directa del snapshot de la guía a la entrada de su builder XML (add-shipping-guides,
// design D11 y D16): sin lecturas ni cálculos. Solo una factura sustento aporta los cuatro datos del
// sustento; una excepción declarada no tiene campo en el XML.
import type { ShippingGuideXmlSnapshot } from "../../sri-engine/application/ports.ts";
import type { ShippingGuideSnapshot } from "../domain/snapshot.ts";

export function toShippingGuideXmlSnapshot(
  snapshot: ShippingGuideSnapshot,
): ShippingGuideXmlSnapshot {
  const { issuer } = snapshot;
  return {
    schemaVersion: snapshot.schema.version,
    environment: snapshot.environmentCode,
    accessKey: snapshot.key.accessKey,
    sequential: snapshot.key.sequential,
    issuer: {
      ruc: issuer.ruc,
      legalName: issuer.legalName,
      tradeName: issuer.tradeName,
      headOfficeAddress: issuer.headOfficeAddress,
      establishment: issuer.establishment.code,
      emissionPoint: issuer.emissionPoint.code,
      establishmentAddress: issuer.establishment.address,
      specialTaxpayerNumber: issuer.specialTaxpayerNumber,
      accountingRequired: issuer.accountingRequired,
      withholdingAgentResolution: issuer.withholdingAgentResolution,
      rimpe: issuer.rimpeCategory !== null,
    },
    departureAddress: snapshot.departure.address,
    carrier: {
      identificationType: snapshot.transporter.identificationType,
      identification: snapshot.transporter.identification,
      legalName: snapshot.transporter.legalName,
    },
    transportStart: snapshot.transportStart,
    transportEnd: snapshot.transportEnd,
    plate: snapshot.plate,
    recipients: snapshot.recipients.map((recipient) => ({
      identification: recipient.identification,
      legalName: recipient.legalName,
      address: recipient.address,
      motive: recipient.motive,
      destinationEstablishmentCode: recipient.destinationEstablishmentCode,
      route: recipient.route,
      support:
        recipient.support.kind === "INTERNAL_INVOICE"
          ? {
              documentType: recipient.support.invoice.documentType,
              documentNumber: recipient.support.invoice.documentNumber,
              authorizationNumber: recipient.support.invoice.authorization.number,
              issueDate: recipient.support.invoice.issueDate,
            }
          : null,
      details: recipient.details.map((detail) => ({
        mainCode: detail.mainCode,
        auxiliaryCode: detail.auxiliaryCode,
        description: detail.description,
        quantity: detail.quantity,
      })),
    })),
  };
}

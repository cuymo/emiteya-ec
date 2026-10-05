// Proyección directa del snapshot de la nota de débito a la entrada de su builder XML
// (add-debit-notes, design D13 y D16): sin lecturas ni cálculos. La forma de pago es la única del
// snapshot, nunca la de la solicitud ni la del catálogo vigente.
import type { DebitNoteXmlSnapshot } from "../../sri-engine/application/ports.ts";
import type { DebitNoteSnapshot } from "../domain/snapshot.ts";

export function toDebitNoteXmlSnapshot(snapshot: DebitNoteSnapshot): DebitNoteXmlSnapshot {
  const { issuer, buyer, invoice } = snapshot;
  const [payment] = snapshot.payments;
  return {
    schemaVersion: snapshot.schema.version,
    environment: snapshot.environmentCode,
    issueDate: snapshot.issueDate,
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
    buyer: {
      identificationType: buyer.identificationType,
      identification: buyer.identification,
      legalName: buyer.legalName,
    },
    modified: {
      documentType: invoice.documentType,
      documentNumber: invoice.documentNumber,
      issueDate: invoice.issueDate,
    },
    withoutTaxes: snapshot.totals.withoutTaxes,
    taxes: snapshot.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
      taxCode,
      rateCode,
      rate: percentage,
      base,
      amount,
    })),
    total: snapshot.totals.total,
    payment: { method: payment.code, total: payment.amount },
    reasons: snapshot.concepts.map((concept) => ({
      reason: concept.description,
      value: concept.amount,
    })),
  };
}

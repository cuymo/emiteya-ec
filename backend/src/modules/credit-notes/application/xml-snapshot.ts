// Proyección directa del snapshot de la nota a la entrada de su builder XML (add-credit-notes,
// design D12 y D24): sin lecturas ni cálculos.
import type { CreditNoteXmlSnapshot } from "../../sri-engine/application/ports.ts";
import type { CreditNoteSnapshot } from "../domain/snapshot.ts";

export function toCreditNoteXmlSnapshot(snapshot: CreditNoteSnapshot): CreditNoteXmlSnapshot {
  const { issuer, buyer, invoice } = snapshot;
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
    lines: snapshot.lines.map((line) => ({
      mainCode: line.mainCode,
      auxiliaryCode: line.auxiliaryCode,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      taxableBase: line.taxableBase,
      taxes: line.taxes.map((tax) => ({
        taxCode: tax.taxCode,
        rateCode: tax.rateCode,
        rate: tax.percentage,
        base: tax.base,
        amount: tax.amount,
      })),
    })),
    totals: {
      withoutTaxes: snapshot.totals.withoutTaxes,
      taxes: snapshot.totals.taxes.map(({ taxCode, rateCode, base, amount }) => ({
        taxCode,
        rateCode,
        base,
        amount,
      })),
      total: snapshot.totals.total,
    },
    reason: snapshot.reason,
  };
}

// Proyección directa del snapshot de la factura a la entrada del builder XML (add-invoice-emission,
// design D4): sin lecturas ni cálculos.
import type { InvoiceSnapshot } from "../../sri-engine/application/ports.ts";
import type { InvoiceSnapshotV1 } from "../domain/snapshot.ts";

export function toXmlSnapshot(snapshot: InvoiceSnapshotV1): InvoiceSnapshot {
  const { issuer, buyer } = snapshot;
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
      address: buyer.address,
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
      discount: snapshot.totals.discount,
      taxes: snapshot.totals.taxes.map(({ taxCode, rateCode, base, amount }) => ({
        taxCode,
        rateCode,
        base,
        amount,
      })),
      total: snapshot.totals.total,
    },
    payments: snapshot.payments.map((payment) => ({ method: payment.code, total: payment.amount })),
  };
}

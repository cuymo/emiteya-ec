// Proyección directa del snapshot de la liquidación de compra a la entrada de su builder XML
// (add-purchase-settlements, design D11 y D15): sin lecturas ni cálculos. Las declaraciones de
// procedencia, el actor y el momento no se proyectan: no van en el XML.
import type { PurchaseSettlementXmlSnapshot } from "../../sri-engine/application/ports.ts";
import type { PurchaseSettlementSnapshot } from "../domain/snapshot.ts";

export function toPurchaseSettlementXmlSnapshot(
  snapshot: PurchaseSettlementSnapshot,
): PurchaseSettlementXmlSnapshot {
  const { issuer, supplier, totals } = snapshot;
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
    supplier: {
      identificationType: supplier.identificationType,
      identification: supplier.identification,
      legalName: supplier.legalName,
      address: supplier.address,
    },
    lines: snapshot.lines.map((line) => ({
      mainCode: line.mainCode,
      auxiliaryCode: line.auxiliaryCode,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: line.discount,
      taxableBase: line.taxableBase,
      tax: {
        taxCode: line.tax.taxCode,
        rateCode: line.tax.rateCode,
        rate: line.tax.percentage,
        base: line.tax.base,
        amount: line.tax.amount,
      },
    })),
    totals: {
      withoutTaxes: totals.withoutTaxes,
      discount: totals.discount,
      taxes: totals.taxes.map((tax) => ({
        taxCode: tax.taxCode,
        rateCode: tax.rateCode,
        rate: tax.percentage,
        base: tax.base,
        amount: tax.amount,
      })),
      total: totals.total,
    },
    currency: snapshot.currency,
    payments: snapshot.payments.map((payment) => ({
      method: payment.code,
      total: payment.total,
      term: payment.term,
      timeUnit: payment.timeUnit,
    })),
  };
}

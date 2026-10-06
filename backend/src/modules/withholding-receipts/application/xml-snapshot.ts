// Proyección directa del snapshot del comprobante de retención a la entrada de su builder XML
// (add-withholding-receipts, design D14 y D17): sin lecturas ni cálculos. Los códigos del documento
// sustento viajan como el texto de dos caracteres que congeló la reserva.
import type { WithholdingReceiptXmlSnapshot } from "../../sri-engine/application/ports.ts";
import type { WithholdingSnapshot } from "../domain/snapshot.ts";

export function toWithholdingReceiptXmlSnapshot(
  snapshot: WithholdingSnapshot,
): WithholdingReceiptXmlSnapshot {
  const { issuer, subject } = snapshot;
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
    subject: {
      identificationType: subject.identificationType,
      identification: subject.identification,
      legalName: subject.legalName,
    },
    relatedParty: snapshot.relatedParty.value,
    fiscalPeriod: snapshot.fiscalPeriod,
    supports: snapshot.supports.map((support) => ({
      supportCode: support.supportCode.code,
      documentType: support.documentType.code,
      number: support.number,
      issueDate: support.issueDate,
      authorizationNumber: support.authorizationNumber,
      totalWithoutTaxes: support.totalWithoutTaxes,
      importTotal: support.importTotal,
      taxes: support.taxes.map((tax) => ({
        taxCode: tax.taxCode,
        rateCode: tax.rateCode,
        base: tax.base,
        tariff: tax.tariff,
        amount: tax.amount,
      })),
      withholdings: support.withholdings.map((item) => ({
        taxCode: item.tax,
        code: item.code,
        base: item.base,
        percentage: item.percentage,
        amount: item.amount,
      })),
      payments: support.payments.map((payment) => ({ method: payment.code, total: payment.total })),
    })),
  };
}

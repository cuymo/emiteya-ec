// Lecturas de la evaluación compuestas con las fábricas internas de los otros módulos sobre un mismo
// cliente (add-invoice-emission, design D1): la conexión para la vista previa o la transacción de
// reserva para la emisión. invoices nunca lee tablas ajenas.
import {
  PRODUCT_TAX_SLOTS,
  type FiscalCatalogType,
  type ProductTaxSlot,
} from "@facturador/contracts";
import type { DbClient } from "../../../platform/db/database.ts";
import { fiscalCatalogQueries } from "../../catalogs/infrastructure/index.ts";
import { partyReader } from "../../parties/infrastructure/index.ts";
import { productReader } from "../../products/infrastructure/index.ts";
import { taxpayerEmissionReads } from "../../taxpayer/infrastructure/index.ts";
import type { ActiveCertificateRead, EvaluationReads, StockReads } from "../application/ports.ts";
import type { EvaluationProduct } from "../domain/evaluation.ts";

/** Firma vigente sobre un cliente: `signingModule(...).reads`. */
export type SigningReads = (db: DbClient) => {
  activeCertificate(companyId: string): Promise<ActiveCertificateRead | null>;
};

export function createEvaluationReads(
  db: DbClient,
  signingReads: SigningReads,
  stockReads: StockReads,
): EvaluationReads {
  const taxpayer = taxpayerEmissionReads(db);
  const parties = partyReader(db);
  const products = productReader(db);
  const catalogs = fiscalCatalogQueries(db);
  const signing = signingReads(db);
  const stock = stockReads(db);
  return {
    currentConfig: (companyId) => taxpayer.currentConfig(companyId),
    emissionPoint: (companyId, emissionPointId) =>
      taxpayer.emissionPoint(companyId, emissionPointId),
    activeCertificate: (companyId) => signing.activeCertificate(companyId),
    party: (companyId, partyId) => parties.find(companyId, partyId),
    async product(companyId, productId): Promise<EvaluationProduct | null> {
      const found = await products.find(companyId, productId);
      if (!found) return null;
      return {
        id: found.id,
        mainCode: found.mainCode,
        auxiliaryCode: found.auxiliaryCode,
        name: found.name,
        unitPrice: found.unitPrice,
        status: found.status,
        stockTracked: found.stockTracked,
        taxes: (Object.keys(PRODUCT_TAX_SLOTS) as ProductTaxSlot[]).flatMap((slot) => {
          const entryKey = found.taxes[slot];
          return entryKey ? [{ catalogType: PRODUCT_TAX_SLOTS[slot], entryKey }] : [];
        }),
      };
    },
    stock: (companyId, productIds) => stock.balances(companyId, productIds),
    catalogs: {
      availability: (companyId, catalogType, date) =>
        catalogs.availability(companyId, catalogType as FiscalCatalogType, date),
      identificationRule: (code, date) => catalogs.identificationRule(code, date),
      consumerFinalPolicy: (date) => catalogs.consumerFinalPolicy(date),
      specialCases: () => catalogs.specialCases(),
      schemaRegistry: () => catalogs.schemaRegistry(),
      datasetVersions: () => catalogs.datasetVersions(),
    },
  };
}

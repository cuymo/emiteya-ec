// Arnés de las pruebas de las liquidaciones de compra (add-purchase-settlements): un proveedor con el
// rol de proveedor y cédula, y una liquidación 03 en cualquier estado con su registro y sus cuatro
// declaraciones escritos en la misma transacción (la base los exige al confirmar), con el XML firmado
// sintético del arnés de la transmisión. Su snapshot es el mínimo que la transmisión necesita: la
// clave.
import { PURCHASE_SETTLEMENT_STATEMENTS } from "@facturador/contracts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { searchKey } from "../../src/platform/search/search-key.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

/** Tercero activo para una liquidación: por defecto con cédula, dirección y el rol de proveedor. */
export async function insertPurchaseSupplier(
  prisma: PrismaClient,
  company: Pick<FiscalCompany, "companyId" | "adminId">,
  identification = "0102030405",
  options: {
    roles?: string[];
    identificationType?: string;
    legalName?: string;
    address?: string | null;
    status?: "ACTIVE" | "INACTIVE";
  } = {},
): Promise<string> {
  const legalName = options.legalName ?? `Proveedor ${identification}`;
  const party = await prisma.party.create({
    data: {
      companyId: company.companyId,
      identificationType:
        options.identificationType ?? (identification.length === 13 ? "04" : "05"),
      identification,
      legalName,
      address: options.address === undefined ? "Comunidad San Pablo, Cayambe" : options.address,
      roles: options.roles ?? ["SUPPLIER"],
      status: options.status ?? "ACTIVE",
      searchName: searchKey(legalName),
      searchIdentification: identification,
      createdBy: company.adminId,
      updatedBy: company.adminId,
    },
  });
  return party.id;
}

/** Liquidación 03 en `state`, con su registro y sus cuatro declaraciones en la misma transacción. */
export function insertPurchaseSettlement(
  prisma: PrismaClient,
  company: FiscalCompany,
  partyId: string,
  state: string,
  options: { total?: string; buyer?: { identification: string; name: string } } = {},
): Promise<TestDocument> {
  return insertDocument(prisma, company, state, {
    documentType: "03",
    total: options.total ?? "106.00",
    buyer: options.buyer ?? { identification: "0102030405", name: "María Quishpe" },
    alongside: async (tx, document) => {
      await tx.purchaseSettlement.create({
        data: {
          companyId: company.companyId,
          documentId: document.id,
          supplierPartyId: partyId,
          eligibilityCase: "ART_13_C",
          eligibilityPolicy: "PURCHASE_SETTLEMENT_ELIGIBILITY_V1",
          policyVersion: 1,
          lineCount: 2,
          paymentCount: 2,
        },
      });
      await tx.purchaseSettlementDeclaration.createMany({
        data: PURCHASE_SETTLEMENT_STATEMENTS.map((statementId) => ({
          companyId: company.companyId,
          documentId: document.id,
          statementId,
          policyVersion: 1,
          basis: "USER_DECLARED",
          declaredBy: company.adminId,
          declaredAt: new Date("2026-10-07T15:00:00Z"),
        })),
      });
    },
  });
}

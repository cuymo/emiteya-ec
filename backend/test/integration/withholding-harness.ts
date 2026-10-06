// Arnés de las pruebas de los comprobantes de retención (add-withholding-receipts): un comprobante
// 07 en cualquier estado con su registro y una línea escritos en la misma transacción (la base los
// exige al confirmar) y el XML firmado sintético del arnés de la transmisión. Su snapshot es el
// mínimo que la transmisión necesita: la clave.
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

/** Proveedor activo con RUC, para el registro del comprobante. */
export async function insertSupplier(
  prisma: PrismaClient,
  company: FiscalCompany,
  identification = "1791234567001",
): Promise<string> {
  const party = await prisma.party.create({
    data: {
      companyId: company.companyId,
      identificationType: "04",
      identification,
      legalName: `Proveedor ${identification}`,
      roles: ["SUPPLIER"],
      searchName: `proveedor ${identification}`,
      searchIdentification: identification,
      createdBy: company.adminId,
      updatedBy: company.adminId,
    },
  });
  return party.id;
}

export function insertWithholding(
  prisma: PrismaClient,
  company: FiscalCompany,
  partyId: string,
  state: string,
  options: { total?: string } = {},
): Promise<TestDocument> {
  return insertDocument(prisma, company, state, {
    documentType: "07",
    total: options.total ?? "1.76",
    alongside: async (tx, document) => {
      await tx.withholdingReceipt.create({
        data: {
          companyId: company.companyId,
          documentId: document.id,
          partyId,
          relatedParty: "NO",
          fiscalPeriod: "10/2026",
        },
      });
      await tx.withholdingReceiptLine.create({
        data: {
          companyId: company.companyId,
          documentId: document.id,
          supportPosition: 1,
          position: 1,
          supportDocumentType: "01",
          supportCode: "01",
          supportNumber: "001001000000123",
          supportIssueDate: new Date("2026-10-01"),
          tax: "1",
          withholdingCode: "312C",
          entryKey: "312C",
          base: "100.29",
          percentage: "1.75",
          amount: "1.76",
        },
      });
    },
  });
}

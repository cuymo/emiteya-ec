// Arnés de las pruebas de las notas de débito (add-debit-notes): una nota de débito en cualquier
// estado sobre una factura autorizada, con la factura registrada en la misma transacción (la base la
// exige al confirmar) y el XML firmado sintético. Su snapshot es el mínimo que la transmisión
// necesita: la clave.
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

export function insertDebitNote(
  prisma: PrismaClient,
  company: FiscalCompany,
  invoiceId: string,
  state: string,
  options: {
    total?: string;
    /** Para los reportes (add-reports-export): los importes del snapshot, la fecha y el ambiente. */
    snapshot?: Record<string, unknown>;
    issueDate?: string;
    environment?: "TEST" | "PRODUCTION";
  } = {},
): Promise<TestDocument> {
  return insertDocument(prisma, company, state, {
    documentType: "05",
    total: options.total ?? "23.00",
    ...(options.snapshot ? { snapshot: options.snapshot } : {}),
    ...(options.issueDate ? { issueDate: options.issueDate } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    alongside: async (tx, document) => {
      await tx.debitNoteSupport.create({
        data: { companyId: company.companyId, debitNoteId: document.id, invoiceId },
      });
    },
  });
}

// Unidades de trabajo de las notas de débito (add-debit-notes, design D14): los borradores con sus
// conceptos, y la transacción de `RESERVED` de la emisión, que compone sobre una misma transacción
// las lecturas y escrituras internas de taxpayer, fiscal, invoices (la factura de origen), el
// registro de idempotencia y la auditoría. Sin I/O externo ni XML dentro, y sin capacidades ni
// inventario (design D12).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createIdempotencyStore } from "../../../platform/idempotency/prisma-idempotency-store.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import {
  createDocumentRepository,
  createFiscalScope,
  reserveSequentialIn,
} from "../../fiscal/infrastructure/index.ts";
import { createTaxpayerScope, lockTaxIdentityIn } from "../../taxpayer/infrastructure/index.ts";
import type {
  DebitNoteDraftsUnitOfWork,
  DebitNoteEmissionUnitOfWork,
  InvoiceSourceReader,
} from "../application/ports.ts";
import { createDebitNoteDraftRepository } from "./prisma-drafts.ts";
import { createDebitNotesReads, type SigningReads } from "./reads.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

export function createDebitNoteDraftsUnitOfWork(prisma: PrismaClient): DebitNoteDraftsUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work({ drafts: createDebitNoteDraftRepository(tx) })),
  };
}

export function createDebitNoteEmissionUnitOfWork(
  prisma: PrismaClient,
  ports: Readonly<{ signingReads: SigningReads; invoices: InvoiceSourceReader }>,
): DebitNoteEmissionUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction(
        (tx) => {
          const taxpayer = createTaxpayerScope(tx);
          const drafts = createDebitNoteDraftRepository(tx);
          return work({
            async lockDraft(companyId, draftId) {
              // Un UPDATE sin cambios toma el mismo bloqueo de fila que SELECT … FOR UPDATE. Un
              // borrador emitido es inmutable: otra emisión lo encuentra EMITTED.
              await tx.debitNoteDraft.updateMany({
                where: { id: draftId, companyId, status: "DRAFT" },
                data: { companyId },
              });
              return drafts.find(companyId, draftId);
            },
            async markDraftEmitted(companyId, draftId, documentId, userId) {
              await tx.debitNoteDraft.updateMany({
                where: { id: draftId, companyId, status: "DRAFT" },
                data: { status: "EMITTED", documentId, updatedBy: userId, updatedAt: new Date() },
              });
            },
            lockConfiguration: (companyId) => taxpayer.lockConfiguration(companyId),
            async recordSupport(companyId, debitNoteId, invoiceId) {
              await tx.debitNoteSupport.create({ data: { companyId, debitNoteId, invoiceId } });
            },
            reads: createDebitNotesReads(tx, ports.signingReads),
            invoices: ports.invoices(tx),
            reserveSequential: ({ reservedBy, correlationId, ...key }) =>
              reserveSequentialIn(createFiscalScope(tx), { ...key, reservedBy, correlationId }),
            lockTaxIdentity: (companyId) => lockTaxIdentityIn(taxpayer, companyId),
            documents: createDocumentRepository(tx),
            idempotency: createIdempotencyStore(tx),
            audit: createAuditLog(tx),
          });
        },
        { timeout: TRANSACTION_TIMEOUT_MS },
      ),
  };
}

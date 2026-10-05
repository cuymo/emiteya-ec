// Unidades de trabajo de las notas de crédito (add-credit-notes, design D4, D7 y D10): los borradores
// con sus líneas, y la transacción de `RESERVED` de la emisión, que compone sobre una misma
// transacción las lecturas y escrituras internas de taxpayer, fiscal, invoices (la factura de
// origen), el inventario (la capacidad devolvible), el registro de idempotencia y la auditoría. Sin
// I/O externo ni XML dentro.
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
  CreditNoteDraftsUnitOfWork,
  CreditNoteEmissionUnitOfWork,
  InvoiceCreditSourceReader,
  ReturnCapacity,
} from "../application/ports.ts";
import { createCreditCapacityRepository } from "./prisma-credit-capacity.ts";
import { createCreditNoteDraftRepository } from "./prisma-drafts.ts";
import { createCreditNotesReads, type SigningReads } from "./reads.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

export function createCreditNoteDraftsUnitOfWork(prisma: PrismaClient): CreditNoteDraftsUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work({ drafts: createCreditNoteDraftRepository(tx) })),
  };
}

export function createCreditNoteEmissionUnitOfWork(
  prisma: PrismaClient,
  ports: Readonly<{
    signingReads: SigningReads;
    invoices: InvoiceCreditSourceReader;
    returns: ReturnCapacity;
  }>,
): CreditNoteEmissionUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction(
        (tx) => {
          const taxpayer = createTaxpayerScope(tx);
          const drafts = createCreditNoteDraftRepository(tx);
          return work({
            async lockDraft(companyId, draftId) {
              // Un UPDATE sin cambios toma el mismo bloqueo de fila que SELECT … FOR UPDATE. Un
              // borrador emitido es inmutable: otra emisión lo encuentra EMITTED.
              await tx.creditNoteDraft.updateMany({
                where: { id: draftId, companyId, status: "DRAFT" },
                data: { companyId },
              });
              return drafts.find(companyId, draftId);
            },
            async markDraftEmitted(companyId, draftId, documentId, userId) {
              await tx.creditNoteDraft.updateMany({
                where: { id: draftId, companyId, status: "DRAFT" },
                data: { status: "EMITTED", documentId, updatedBy: userId, updatedAt: new Date() },
              });
            },
            lockConfiguration: (companyId) => taxpayer.lockConfiguration(companyId),
            reads: createCreditNotesReads(tx, ports.signingReads),
            invoices: ports.invoices(tx),
            capacity: createCreditCapacityRepository(tx),
            returns: ports.returns(tx),
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

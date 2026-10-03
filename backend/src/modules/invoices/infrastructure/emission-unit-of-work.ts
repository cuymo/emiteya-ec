// Unidad de trabajo de la emisión (add-invoice-emission, design D1 y D7): compone sobre una misma
// transacción las lecturas y escrituras internas de taxpayer, fiscal, parties, products, catalogs y
// signing, el registro de idempotencia y la auditoría. Usa el plazo por defecto de Prisma: la
// transacción no hace I/O externo ni construye XML.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createIdempotencyStore } from "../../../platform/idempotency/prisma-idempotency-store.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import {
  createDocumentRepository,
  createFiscalScope,
  reserveSequentialIn,
} from "../../fiscal/infrastructure/index.ts";
import { createTaxpayerScope, lockTaxIdentityIn } from "../../taxpayer/infrastructure/index.ts";
import type { EmissionUnitOfWork } from "../application/ports.ts";
import { createEvaluationReads, type SigningReads } from "./evaluation-reads.ts";
import { createDraftRepository } from "./prisma-drafts.ts";

export function createEmissionUnitOfWork(
  prisma: PrismaClient,
  signingReads: SigningReads,
): EmissionUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => {
        const drafts = createDraftRepository(tx);
        const taxpayer = createTaxpayerScope(tx);
        return work({
          async lockDraft(companyId, draftId) {
            // Un UPDATE sin cambios toma el mismo bloqueo de fila que SELECT … FOR UPDATE, con las
            // consultas del modelo (el esquema de la conexión no se aplica al SQL crudo). Un borrador
            // ya emitido es inmutable y no necesita bloqueo: otra emisión lo encuentra EMITTED.
            await tx.invoiceDraft.updateMany({
              where: { id: draftId, companyId, status: "DRAFT" },
              data: { companyId },
            });
            return drafts.find(companyId, draftId);
          },
          async markDraftEmitted(companyId, draftId, documentId, userId) {
            await tx.invoiceDraft.updateMany({
              where: { id: draftId, companyId, status: "DRAFT" },
              data: { status: "EMITTED", documentId, updatedBy: userId, updatedAt: new Date() },
            });
          },
          lockConfiguration: (companyId) => taxpayer.lockConfiguration(companyId),
          reads: createEvaluationReads(tx, signingReads),
          reserveSequential: ({ reservedBy, correlationId, ...key }) =>
            reserveSequentialIn(createFiscalScope(tx), { ...key, reservedBy, correlationId }),
          lockTaxIdentity: (companyId) => lockTaxIdentityIn(taxpayer, companyId),
          documents: createDocumentRepository(tx),
          idempotency: createIdempotencyStore(tx),
          audit: createAuditLog(tx),
        });
      }),
  };
}

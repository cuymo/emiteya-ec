// Unidades de trabajo de las liquidaciones de compra (add-purchase-settlements, design D13 y D25): los
// borradores, y la transacción de `RESERVED` de la emisión, que compone sobre una misma transacción
// las lecturas y escrituras internas de taxpayer, fiscal y catalogs, las lecturas de terceros y de
// productos (inyectadas), el registro de la liquidación con sus cuatro declaraciones, el registro de
// idempotencia y la auditoría. Sin I/O externo ni XML dentro, y sin inventario, capacidades, compras
// ni retenciones.
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
  PurchaseProductReader,
  PurchaseSettlementDraftsUnitOfWork,
  PurchaseSettlementEmissionUnitOfWork,
  PurchaseSupplierReader,
} from "../application/ports.ts";
import { createPurchaseSettlementDraftRepository } from "./prisma-drafts.ts";
import { createPurchaseSettlementReads, type SigningReads } from "./reads.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

export function createPurchaseSettlementDraftsUnitOfWork(
  prisma: PrismaClient,
): PurchaseSettlementDraftsUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work({ drafts: createPurchaseSettlementDraftRepository(tx) })),
  };
}

export function createPurchaseSettlementEmissionUnitOfWork(
  prisma: PrismaClient,
  ports: Readonly<{
    signingReads: SigningReads;
    suppliers: PurchaseSupplierReader;
    products: PurchaseProductReader;
  }>,
): PurchaseSettlementEmissionUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction(
        (tx) => {
          const taxpayer = createTaxpayerScope(tx);
          const drafts = createPurchaseSettlementDraftRepository(tx);
          return work({
            async lockDraft(companyId, draftId) {
              // Un UPDATE sin cambios toma el mismo bloqueo de fila que SELECT … FOR UPDATE. Un
              // borrador emitido es inmutable: otra emisión lo encuentra EMITTED.
              await tx.purchaseSettlementDraft.updateMany({
                where: { id: draftId, companyId, status: "DRAFT" },
                data: { companyId },
              });
              return drafts.find(companyId, draftId);
            },
            async markDraftEmitted(companyId, draftId, documentId, userId) {
              await tx.purchaseSettlementDraft.updateMany({
                where: { id: draftId, companyId, status: "DRAFT" },
                data: { status: "EMITTED", documentId, updatedBy: userId, updatedAt: new Date() },
              });
            },
            lockConfiguration: (companyId) => taxpayer.lockConfiguration(companyId),
            async recordSettlement(companyId, record) {
              await tx.purchaseSettlement.create({
                data: {
                  companyId,
                  documentId: record.documentId,
                  supplierPartyId: record.supplierPartyId,
                  eligibilityCase: record.eligibilityCase,
                  eligibilityPolicy: record.eligibilityPolicy,
                  policyVersion: record.policyVersion,
                  lineCount: record.lineCount,
                  paymentCount: record.paymentCount,
                },
              });
              await tx.purchaseSettlementDeclaration.createMany({
                data: record.declarations.map((declaration) => ({
                  companyId,
                  documentId: record.documentId,
                  statementId: declaration.statementId,
                  policyVersion: declaration.policyVersion,
                  basis: declaration.basis,
                  declaredBy: declaration.declaredBy,
                  declaredAt: declaration.declaredAt,
                })),
              });
            },
            reads: createPurchaseSettlementReads(tx, ports.signingReads),
            suppliers: ports.suppliers(tx),
            products: ports.products(tx),
            reserveSequential: ({ reservedBy, correlationId, ...key }) =>
              reserveSequentialIn(createFiscalScope(tx), { ...key, reservedBy, correlationId }),
            lockTaxIdentity: (companyId) => lockTaxIdentityIn(taxpayer, companyId),
            documents: createDocumentRepository(tx),
            idempotency: createIdempotencyStore(tx),
            audit: createAuditLog(tx),
            async userName(companyId, userId) {
              const member = await tx.member.findFirst({
                where: { organizationId: companyId, userId },
                select: { user: { select: { name: true } } },
              });
              return member?.user.name ?? null;
            },
          });
        },
        { timeout: TRANSACTION_TIMEOUT_MS },
      ),
  };
}

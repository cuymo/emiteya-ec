// Unidades de trabajo de los comprobantes de retención (add-withholding-receipts, design D15 y D28):
// los borradores, y la transacción de `RESERVED` de la emisión, que compone sobre una misma
// transacción las lecturas y escrituras internas de taxpayer, fiscal, catalogs, la lectura de
// terceros de `parties` (inyectada), el registro del comprobante con sus líneas, el registro de
// idempotencia y la auditoría. Sin I/O externo ni XML dentro, y sin inventario, capacidades ni
// facturas.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { FiscalDecimal } from "../../../platform/decimal/fiscal-decimal.ts";
import { createIdempotencyStore } from "../../../platform/idempotency/prisma-idempotency-store.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import {
  createDocumentRepository,
  createFiscalScope,
  reserveSequentialIn,
} from "../../fiscal/infrastructure/index.ts";
import { createTaxpayerScope, lockTaxIdentityIn } from "../../taxpayer/infrastructure/index.ts";
import type {
  WithheldPartyReader,
  WithholdingDraftsUnitOfWork,
  WithholdingEmissionUnitOfWork,
} from "../application/ports.ts";
import { createWithholdingDraftRepository } from "./prisma-drafts.ts";
import { createWithholdingReads, type SigningReads } from "./reads.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

export function createWithholdingDraftsUnitOfWork(
  prisma: PrismaClient,
): WithholdingDraftsUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work({ drafts: createWithholdingDraftRepository(tx) })),
  };
}

export function createWithholdingEmissionUnitOfWork(
  prisma: PrismaClient,
  ports: Readonly<{ signingReads: SigningReads; parties: WithheldPartyReader }>,
): WithholdingEmissionUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction(
        (tx) => {
          const taxpayer = createTaxpayerScope(tx);
          const drafts = createWithholdingDraftRepository(tx);
          return work({
            async lockDraft(companyId, draftId) {
              // Un UPDATE sin cambios toma el mismo bloqueo de fila que SELECT … FOR UPDATE. Un
              // borrador emitido es inmutable: otra emisión lo encuentra EMITTED.
              await tx.withholdingReceiptDraft.updateMany({
                where: { id: draftId, companyId, status: "DRAFT" },
                data: { companyId },
              });
              return drafts.find(companyId, draftId);
            },
            async markDraftEmitted(companyId, draftId, documentId, userId) {
              await tx.withholdingReceiptDraft.updateMany({
                where: { id: draftId, companyId, status: "DRAFT" },
                data: { status: "EMITTED", documentId, updatedBy: userId, updatedAt: new Date() },
              });
            },
            lockConfiguration: (companyId) => taxpayer.lockConfiguration(companyId),
            async recordReceipt(companyId, record) {
              await tx.withholdingReceipt.create({
                data: {
                  companyId,
                  documentId: record.documentId,
                  partyId: record.partyId,
                  relatedParty: record.relatedParty,
                  fiscalPeriod: record.fiscalPeriod,
                },
              });
              await tx.withholdingReceiptLine.createMany({
                data: record.lines.map((line) => ({
                  companyId,
                  documentId: record.documentId,
                  supportPosition: line.supportPosition,
                  position: line.position,
                  supportDocumentType: line.supportDocumentType,
                  supportCode: line.supportCode,
                  supportNumber: line.supportNumber,
                  supportIssueDate: new Date(`${line.supportIssueDate}T00:00:00.000Z`),
                  tax: line.tax,
                  withholdingCode: line.withholdingCode,
                  entryKey: line.entryKey,
                  base: FiscalDecimal.parse("importe", line.base).toDatabase(),
                  percentage: FiscalDecimal.parse(
                    "porcentajeRetener",
                    line.percentage,
                  ).toDatabase(),
                  amount: FiscalDecimal.parse("importe", line.amount).toDatabase(),
                })),
              });
            },
            reads: createWithholdingReads(tx, ports.signingReads),
            parties: ports.parties(tx),
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

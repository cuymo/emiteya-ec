// Unidades de trabajo de las guías de remisión (add-shipping-guides, design D13 y D26): los
// borradores, y la transacción de `RESERVED` de la emisión, que compone sobre una misma transacción
// las lecturas y escrituras internas de taxpayer y fiscal, las lecturas inyectadas de terceros,
// productos y facturas, el registro de la guía y de sus destinatarios, el registro de idempotencia y
// la auditoría. Sin I/O externo ni XML dentro, y sin inventario ni capacidades.
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
  ShippingGuideDraftsUnitOfWork,
  ShippingGuideEmissionUnitOfWork,
  ShippingInvoiceReader,
  ShippingPartyReader,
  ShippingProductReader,
} from "../application/ports.ts";
import { createShippingGuideDraftRepository } from "./prisma-drafts.ts";
import { createShippingGuideReads, type SigningReads } from "./reads.ts";

const TRANSACTION_TIMEOUT_MS = 10_000;

const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

export function createShippingGuideDraftsUnitOfWork(
  prisma: PrismaClient,
): ShippingGuideDraftsUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work({ drafts: createShippingGuideDraftRepository(tx) })),
  };
}

export function createShippingGuideEmissionUnitOfWork(
  prisma: PrismaClient,
  ports: Readonly<{
    signingReads: SigningReads;
    parties: ShippingPartyReader;
    products: ShippingProductReader;
    invoices: ShippingInvoiceReader;
  }>,
): ShippingGuideEmissionUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction(
        (tx) => {
          const taxpayer = createTaxpayerScope(tx);
          const drafts = createShippingGuideDraftRepository(tx);
          return work({
            async lockDraft(companyId, draftId) {
              // Un UPDATE sin cambios toma el mismo bloqueo de fila que SELECT … FOR UPDATE. Un
              // borrador emitido es inmutable: otra emisión lo encuentra EMITTED.
              await tx.shippingGuideDraft.updateMany({
                where: { id: draftId, companyId, status: "DRAFT" },
                data: { companyId },
              });
              return drafts.find(companyId, draftId);
            },
            async markDraftEmitted(companyId, draftId, documentId, userId) {
              await tx.shippingGuideDraft.updateMany({
                where: { id: draftId, companyId, status: "DRAFT" },
                data: { status: "EMITTED", documentId, updatedBy: userId, updatedAt: new Date() },
              });
            },
            lockConfiguration: (companyId) => taxpayer.lockConfiguration(companyId),
            async recordGuide(companyId, record) {
              await tx.shippingGuide.create({
                data: {
                  companyId,
                  documentId: record.documentId,
                  originEstablishmentId: record.originEstablishmentId,
                  transporterSource: record.transporterSource,
                  carrierPartyId: record.carrierPartyId,
                  carrierIdentificationType: record.carrierIdentificationType,
                  carrierIdentification: record.carrierIdentification,
                  carrierName: record.carrierName,
                  plate: record.plate,
                  transportStart: dateOnly(record.transportStart),
                  transportEnd: dateOnly(record.transportEnd),
                  recipientCount: record.recipientCount,
                  detailCount: record.detailCount,
                },
              });
              await tx.shippingGuideRecipient.createMany({
                data: record.recipients.map((recipient) => ({
                  companyId,
                  documentId: record.documentId,
                  ...recipient,
                })),
              });
            },
            reads: createShippingGuideReads(tx, ports.signingReads),
            parties: ports.parties(tx),
            products: ports.products(tx),
            invoices: ports.invoices(tx),
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

// Efectos fiscales de una empresa que un rechazo previo a la reserva nunca produce
// (block-unsupported-special-cases-before-emission, design D7): secuenciales y sus reservas,
// comprobantes y sus artefactos, idempotencia, capacidad de crédito y de devolución, movimientos de
// inventario, trabajos de transmisión e intentos de envío al SRI. Se comparan antes y después.
import type { Database } from "../../src/platform/db/database.ts";

export async function fiscalEffects(prisma: Database["prisma"], companyId: string) {
  const where = { companyId };
  return {
    sequences: await prisma.fiscalSequence.findMany({
      where,
      select: { documentType: true, nextNumber: true },
      orderBy: [{ documentType: "asc" }, { emissionPointId: "asc" }],
    }),
    reservations: await prisma.fiscalSequenceReservation.count({ where }),
    documents: await prisma.electronicDocument.count({ where }),
    artifacts: await prisma.documentArtifact.count({ where }),
    idempotency: await prisma.idempotencyRecord.count({ where }),
    creditReservations: await prisma.creditReservation.count({ where }),
    stockReturnReservations: await prisma.stockReturnReservation.count({ where }),
    stockMovements: await prisma.stockMovement.count({ where }),
    jobs: await prisma.job.count({ where }),
    sriAttempts: await prisma.sriAttempt.count({ where }),
  };
}

// Unidades de trabajo de las guías de remisión (add-shipping-guides, design D13 y D26): los
// borradores, y la transacción de `RESERVED` de la emisión, que compone sobre una misma transacción
// las lecturas y escrituras internas de taxpayer y fiscal, las lecturas inyectadas de terceros,
// productos y facturas, el registro de la guía y de sus destinatarios, el registro de idempotencia y
// la auditoría. Sin I/O externo ni XML dentro, y sin inventario ni capacidades.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { ShippingGuideDraftsUnitOfWork } from "../application/ports.ts";
import { createShippingGuideDraftRepository } from "./prisma-drafts.ts";

export function createShippingGuideDraftsUnitOfWork(
  prisma: PrismaClient,
): ShippingGuideDraftsUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) => work({ drafts: createShippingGuideDraftRepository(tx) })),
  };
}

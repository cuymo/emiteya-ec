// Unidad de trabajo de los envíos (add-email-delivery, design D6 y D11): el intento, el estado del
// envío y la decisión del trabajo en la misma transacción; el reenvío, con su evento de auditoría.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { EmailDeliveryUnitOfWork } from "../application/ports.ts";
import { createEmailDeliveryRepository } from "./prisma-email-deliveries.ts";

export function createEmailDeliveryUnitOfWork(
  prisma: PrismaClient,
  schema = "public",
): EmailDeliveryUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) =>
        work({
          db: tx,
          deliveries: createEmailDeliveryRepository(tx, schema),
          audit: createAuditLog(tx),
        }),
      ),
  };
}

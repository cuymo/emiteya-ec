// Unidad de trabajo de los envíos (add-email-delivery, design D6): el intento, el estado del envío y
// la decisión del trabajo en la misma transacción.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { EmailDeliveryUnitOfWork } from "../application/ports.ts";
import { createEmailDeliveryRepository } from "./prisma-email-deliveries.ts";

export function createEmailDeliveryUnitOfWork(
  prisma: PrismaClient,
  schema = "public",
): EmailDeliveryUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) =>
        work({ db: tx, deliveries: createEmailDeliveryRepository(tx, schema) }),
      ),
  };
}

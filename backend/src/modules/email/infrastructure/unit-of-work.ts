// Unidad de trabajo del correo (add-email-delivery, design D11): la configuración y su auditoría en
// la misma transacción.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import type { EmailUnitOfWork } from "../application/ports.ts";
import { createEmailSettingsRepository } from "./prisma-email-settings.ts";

export function createEmailUnitOfWork(prisma: PrismaClient): EmailUnitOfWork {
  return {
    run: (work) =>
      prisma.$transaction((tx) =>
        work({ settings: createEmailSettingsRepository(tx), audit: createAuditLog(tx) }),
      ),
  };
}

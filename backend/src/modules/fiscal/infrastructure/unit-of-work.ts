// Unidad de trabajo de la numeración (design D1 y D5): una transacción interactiva de Prisma con los
// repositorios y la auditoría ligados a ella. Usa la configuración de transacción por defecto de
// Prisma, que la medición de ERS AC-04 demuestra suficiente (design D5).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import { createAuditLog } from "../../audit/infrastructure/prisma-audit-log.ts";
import { createEstablishmentRepository } from "../../taxpayer/infrastructure/prisma-establishments.ts";
import type { FiscalScope, FiscalUnitOfWork } from "../application/ports.ts";
import { createSequenceRepository } from "./prisma-sequences.ts";

/**
 * Repositorios de la numeración sobre un cliente. La emisión de facturas lo usa para reservar el
 * secuencial dentro de su propia transacción (add-invoice-emission, design D1 y D7).
 */
export function createFiscalScope(db: DbClient): FiscalScope {
  return {
    sequences: createSequenceRepository(db),
    points: createEstablishmentRepository(db),
    audit: createAuditLog(db),
  };
}

export function createFiscalUnitOfWork(prisma: PrismaClient): FiscalUnitOfWork {
  return { run: (work) => prisma.$transaction((tx) => work(createFiscalScope(tx))) };
}

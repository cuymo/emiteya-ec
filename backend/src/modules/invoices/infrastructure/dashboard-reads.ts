// Lectura de los borradores para el tablero de Inicio: cuántos borradores de factura siguen sin
// emitir en la empresa. Un borrador no es un comprobante y no tiene ambiente.
import type { DbClient } from "../../../platform/db/database.ts";

export const invoiceDraftCount = (db: DbClient, companyId: string): Promise<number> =>
  db.invoiceDraft.count({ where: { companyId, status: "DRAFT" } });

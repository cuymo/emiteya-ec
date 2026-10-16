// Lectura de existencias para el tablero de Inicio: los productos con inventario inicializado cuyo
// saldo llegó a cero o es negativo. Un producto sin inventario inicializado no cuenta.
import type { DbClient } from "../../../platform/db/database.ts";

export const outOfStockCount = (db: DbClient, companyId: string): Promise<number> =>
  db.stockBalance.count({ where: { companyId, balance: { lte: 0 } } });

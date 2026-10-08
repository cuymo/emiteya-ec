// Ambiente vigente de la empresa para los reportes (add-reports-export, design D4): el de su
// configuración actual, leído en cada solicitud y nunca del cliente; Pruebas si aún no la tiene,
// como el estado de la empresa.
import type { DbClient } from "../../../platform/db/database.ts";
import { DEFAULT_ENVIRONMENT, type Environment } from "../domain/taxpayer-config.ts";
import { createCompanyConfigRepository } from "./prisma-company-config.ts";

export async function currentEnvironment(db: DbClient, companyId: string): Promise<Environment> {
  const current = await createCompanyConfigRepository(db).findCurrent(companyId);
  return current?.config.environment ?? DEFAULT_ENVIRONMENT;
}

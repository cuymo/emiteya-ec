// RUC vigente de la empresa para la coincidencia con el certificado (design D4): la configuración
// tributaria vigente de taxpayer, que puede corregirse mientras la identidad no esté bloqueada.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { createCompanyConfigRepository } from "../../taxpayer/infrastructure/prisma-company-config.ts";
import type { CompanyRucReader } from "../application/ports.ts";

export function createCompanyRucReader(prisma: PrismaClient): CompanyRucReader {
  const configs = createCompanyConfigRepository(prisma);
  return {
    async currentRuc(companyId) {
      return (await configs.findCurrent(companyId))?.config.profile.ruc ?? null;
    },
  };
}

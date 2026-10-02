// Ensamblado del módulo taxpayer para main.ts y las pruebas (design D1).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { createTaxpayerConfiguration } from "../application/taxpayer-configuration.ts";
import { taxpayerRouter } from "./http/taxpayer-router.ts";
import { createCompanyConfigRepository } from "./prisma-company-config.ts";
import { createTaxpayerUnitOfWork } from "./unit-of-work.ts";

export type TaxpayerModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  logoMaxBytes: number;
};

/** Routers del módulo, en el orden en que se montan bajo /api/v1. */
export function taxpayerRouters({ prisma, authorizer, logoMaxBytes }: TaxpayerModuleOptions) {
  const uow = createTaxpayerUnitOfWork(prisma);
  const configs = createCompanyConfigRepository(prisma);
  return [
    taxpayerRouter({
      configuration: createTaxpayerConfiguration({ uow, configs, authorizer }),
      logoMaxBytes,
    }),
  ];
}

// Ensamblado del módulo taxpayer para main.ts y las pruebas (design D1).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { createTaxpayerConfiguration } from "../application/taxpayer-configuration.ts";
import { createTaxpayerLogo } from "../application/taxpayer-logo.ts";
import { logoRouter } from "./http/logo-router.ts";
import { taxpayerRouter } from "./http/taxpayer-router.ts";
import { createCompanyConfigRepository } from "./prisma-company-config.ts";
import { createConfigurationAssetStore } from "./prisma-configuration-assets.ts";
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
    logoRouter({
      logo: createTaxpayerLogo({
        uow,
        configs,
        assets: createConfigurationAssetStore(prisma),
        authorizer,
        logoMaxBytes,
      }),
      logoMaxBytes,
    }),
  ];
}

// Ensamblado del módulo taxpayer para main.ts y las pruebas (design D1).
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { createTaxpayerConfiguration } from "../application/taxpayer-configuration.ts";
import { createTaxpayerLogo } from "../application/taxpayer-logo.ts";
import { createEstablishments } from "../application/establishments.ts";
import { establishmentsRouter } from "./http/establishments-router.ts";
import { PENDING_SIGNING_CERTIFICATE, createCompanyStatus } from "../application/company-status.ts";
import { createDefaultEmissionPoint } from "../application/default-emission-point.ts";
import type { SigningCertificateReadiness } from "../application/ports.ts";
import { accountRouter } from "./http/account-router.ts";
import { createDefaultEmissionPointRepository } from "./prisma-default-emission-points.ts";
import { logoRouter } from "./http/logo-router.ts";
import { taxpayerRouter } from "./http/taxpayer-router.ts";
import { createCompanyConfigRepository } from "./prisma-company-config.ts";
import { createConfigurationAssetStore } from "./prisma-configuration-assets.ts";
import { createEstablishmentRepository } from "./prisma-establishments.ts";
import { createTaxpayerUnitOfWork } from "./unit-of-work.ts";

// Lecturas y lock de la identidad dentro de la transacción de la emisión (add-invoice-emission, D1).
export { createTaxpayerScope, taxpayerEmissionReads } from "./unit-of-work.ts";
export { lockTaxIdentityIn } from "../application/tax-identity-lock.ts";

export type TaxpayerModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  logoMaxBytes: number;
  /** Requisito de firma; hasta add-signing-certificate, siempre pendiente (design D9). */
  signingCertificate?: SigningCertificateReadiness;
};

/** Routers del módulo, en el orden en que se montan bajo /api/v1. */
export function taxpayerRouters({
  prisma,
  authorizer,
  logoMaxBytes,
  signingCertificate = PENDING_SIGNING_CERTIFICATE,
}: TaxpayerModuleOptions) {
  const uow = createTaxpayerUnitOfWork(prisma);
  const configs = createCompanyConfigRepository(prisma);
  const establishments = createEstablishmentRepository(prisma);
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
    establishmentsRouter(createEstablishments({ uow, establishments, authorizer })),
    accountRouter({
      defaults: createDefaultEmissionPoint({
        defaults: createDefaultEmissionPointRepository(prisma),
        establishments,
        authorizer,
      }),
      status: createCompanyStatus({ configs, establishments, signingCertificate, authorizer }),
    }),
  ];
}

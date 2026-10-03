// Ensamblado del módulo signing para main.ts y las pruebas (add-signing-certificate, design D1).
import type { Registry } from "@prometheus-io/client";
import type { CertificateCustodyConfig } from "../../../config/env.ts";
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import type { DbClient } from "../../../platform/db/database.ts";
import type { CryptoWorkerPool } from "../../../platform/workers/crypto-worker-pool.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { activeCertificateReader } from "../application/active-certificate.ts";
import { createSigningCertificates } from "../application/signing-certificate.ts";
import { createCertificateInspector } from "./certificate-inspector.ts";
import { createCompanyRucReader } from "./company-ruc.ts";
import { createCertificateVault } from "./custody/certificate-vault.ts";
import { signingCertificateRouter } from "./http/signing-certificate-router.ts";
import { registerSigningMetrics } from "./metrics.ts";
import { createCertificateRepository } from "./prisma-certificates.ts";
import { createSigningUnitOfWork } from "./unit-of-work.ts";

export { certificateTasksEntry } from "./certificate-inspector.ts";
export { isSigningCertificateUpload } from "./http/signing-certificate-router.ts";

export type SigningModuleOptions = {
  prisma: PrismaClient;
  authorizer: Authorizer;
  custody: CertificateCustodyConfig;
  maxBytes: number;
  pool: CryptoWorkerPool;
  metrics?: Registry;
  now?: () => Date;
};

export function signingModule(options: SigningModuleOptions) {
  const { custody } = options;
  const vault = custody.enabled
    ? createCertificateVault({
        activeVersion: custody.keyVersion,
        keys: new Map([[custody.keyVersion, custody.key]]),
      })
    : null;
  const now = options.now ?? (() => new Date());
  const service = createSigningCertificates({
    uow: createSigningUnitOfWork(options.prisma),
    certificates: createCertificateRepository(options.prisma),
    companyRuc: createCompanyRucReader(options.prisma),
    inspector: createCertificateInspector(options.pool),
    vault,
    authorizer: options.authorizer,
    maxBytes: options.maxBytes,
    ...(options.now ? { now: options.now } : {}),
  });
  if (options.metrics) registerSigningMetrics(options.metrics, () => service.validityOfAll());
  return {
    routers: [signingCertificateRouter(service, { maxBytes: options.maxBytes })],
    readiness: service.readiness,
    service,
    /** Firma vigente sobre un cliente, también en una transacción ajena (add-invoice-emission, D1). */
    reads: (db: DbClient) =>
      activeCertificateReader({ certificates: createCertificateRepository(db), vault, now }),
  };
}

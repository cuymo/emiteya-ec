// Arnés HTTP del módulo taxpayer: la aplicación real con Better Auth, el contexto de petición de
// design D3 y los routers de usuarios, taxpayer y fiscal montados como en main.ts.
import type { JobStore } from "../../src/platform/jobs/jobs.ts";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Registry } from "@prometheus-io/client";
import { Router } from "express";
import { userSchemas } from "@facturador/contracts";
import { createAuthorizer } from "../../src/modules/identity/application/authorization.ts";
import { createUserAdministration } from "../../src/modules/identity/application/user-administration.ts";
import { usersRouter } from "../../src/modules/identity/infrastructure/http/users-router.ts";
import { taxpayerRouters } from "../../src/modules/taxpayer/infrastructure/index.ts";
import { fiscalRouters } from "../../src/modules/fiscal/infrastructure/index.ts";
import {
  catalogsModule,
  fiscalCatalogQueries,
} from "../../src/modules/catalogs/infrastructure/index.ts";
import { partiesModule } from "../../src/modules/parties/infrastructure/index.ts";
import { productsModule } from "../../src/modules/products/infrastructure/index.ts";
import {
  inventoryInitialization,
  inventoryModule,
  inventoryStockReads,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { invoicesModule } from "../../src/modules/invoices/infrastructure/index.ts";
import type { DocumentSigner } from "../../src/modules/invoices/application/signing-pipeline.ts";
import type { AccessKeys, XsdValidator } from "../../src/modules/sri-engine/application/ports.ts";
import { createXmllintXsdValidator } from "../../src/modules/sri-engine/infrastructure/xmllint-xsd-validator.ts";
import type { CertificateCustodyConfig } from "../../src/config/env.ts";
import {
  isSigningCertificateUpload,
  signingModule,
} from "../../src/modules/signing/infrastructure/index.ts";
import type { CryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { PASSWORD, buildAuthApp, signIn, type AuthApp } from "./auth-harness.ts";
import type { MigratedSchema } from "./database.ts";

export const TEST_LOGO_MAX_BYTES = 64 * 1024;

export type SigningHarnessOptions = {
  pool: CryptoWorkerPool;
  custody: CertificateCustodyConfig;
  maxBytes?: number;
  now?: () => Date;
};

/** Módulo de la firma electrónica, solo si la prueba lo pide (tiene un pool de workers). */
export type InvoicesHarnessOptions = {
  /** `INVOICE_MAX_LINES`; 100 por defecto. */
  maxLines?: number;
  /** Validador XSD; por defecto, sobre los XSD versionados de docs/product/. */
  xsd?: Pick<XsdValidator, "ensureAvailable" | "validate">;
  accessKeys?: AccessKeys;
  /** Firma de comprobantes; por defecto, la del módulo de firma configurado. */
  signer?: DocumentSigner;
  /** false: la emisión se detiene en RESERVED (caída simulada después del commit). */
  signAfterReserve?: boolean;
  /** Reloj de la emisión; por defecto, el de `now`. */
  now?: () => Date;
  /** `EMISSION_STAGE_TIMINGS`: cabecera `Server-Timing` en la emisión. */
  stageTimings?: boolean;
  /** Registro del histograma de las etapas de la emisión. */
  metrics?: Registry;
  /**
   * Cola durable del esquema de la prueba (add-minimal-inventory): el `sri.transmit` que nace al
   * firmar queda en ese esquema y la prueba puede ejecutarlo.
   */
  jobs?: Pick<JobStore, "enqueueIn">;
};

/** Sin firma configurada: ningún comprobante se puede firmar. */
const NO_SIGNER: DocumentSigner = {
  signDocument: () =>
    Promise.reject(
      Object.assign(new Error("sin firma"), { code: "SIGNING_CERTIFICATE_NOT_USABLE" }),
    ),
};

/** Validador XSD de las pruebas: el paquete canónico versionado del producto. */
export const testXsdValidator = () =>
  createXmllintXsdValidator({
    root: fileURLToPath(new URL("../../../docs/product/", import.meta.url)),
  });

export function buildTaxpayerApp(
  db: MigratedSchema,
  options: {
    logoMaxBytes?: number;
    signing?: SigningHarnessOptions;
    invoices?: InvoicesHarnessOptions;
    now?: () => Date;
  } = {},
) {
  return buildAuthApp(db, {
    trustProxy: 1,
    ...(options.signing ? { jsonBodyExceptions: isSigningCertificateUpload } : {}),
    apiRouter: ({ context, memberships, securityEvents, uow }) => {
      const authorizer = createAuthorizer({ memberships, securityEvents });
      const signing = options.signing
        ? signingModule({
            prisma: db.database.prisma,
            authorizer,
            custody: options.signing.custody,
            maxBytes: options.signing.maxBytes ?? 64 * 1024,
            pool: options.signing.pool,
            ...(options.signing.now ? { now: options.signing.now } : {}),
          })
        : null;
      const router = Router()
        .use(context)
        .use(
          usersRouter(
            createUserAdministration({ uow, memberships, authorizer, schemas: userSchemas() }),
          ),
        )
        .use(
          ...taxpayerRouters({
            prisma: db.database.prisma,
            authorizer,
            logoMaxBytes: options.logoMaxBytes ?? TEST_LOGO_MAX_BYTES,
            ...(signing ? { signingCertificate: signing.readiness } : {}),
          }),
        )
        .use(...fiscalRouters({ prisma: db.database.prisma, authorizer }))
        .use(
          ...catalogsModule({
            prisma: db.database.prisma,
            authorizer,
            ...(options.now ? { now: options.now } : {}),
          }).routers,
        )
        .use(
          ...partiesModule({
            prisma: db.database.prisma,
            authorizer,
            rules: fiscalCatalogQueries(db.database.prisma),
            ...(options.now ? { now: options.now } : {}),
          }).routers,
        )
        .use(
          ...productsModule({
            prisma: db.database.prisma,
            authorizer,
            catalogs: fiscalCatalogQueries(db.database.prisma),
            inventoryInitialization,
            ...(options.now ? { now: options.now } : {}),
          }).routers,
          // add-minimal-inventory: el inventario de los productos.
          ...inventoryModule({
            prisma: db.database.prisma,
            authorizer,
            ...(options.now ? { now: options.now } : {}),
          }).routers,
        );
      if (signing) router.use(...signing.routers);
      // Borradores y facturas (add-invoice-emission); sin firma configurada, ninguna es utilizable.
      router.use(
        ...invoicesModule({
          prisma: db.database.prisma,
          authorizer,
          signingReads: signing
            ? signing.reads
            : () => ({ activeCertificate: () => Promise.resolve(null) }),
          stockReads: inventoryStockReads,
          maxLines: options.invoices?.maxLines ?? 100,
          xsd: options.invoices?.xsd ?? testXsdValidator(),
          signer: options.invoices?.signer ?? signing?.documents ?? NO_SIGNER,
          ...(options.invoices?.signAfterReserve === false ? { signAfterReserve: false } : {}),
          ...(options.invoices?.accessKeys ? { accessKeys: options.invoices.accessKeys } : {}),
          ...(options.invoices?.stageTimings ? { stageTimings: true } : {}),
          ...(options.invoices?.metrics ? { metrics: options.invoices.metrics } : {}),
          ...(options.invoices?.jobs ? { jobs: options.invoices.jobs } : {}),
          ...((options.invoices?.now ?? options.now)
            ? { now: options.invoices?.now ?? options.now }
            : {}),
        }).routers,
      );
      return router;
    },
  });
}

/** Abre una sesión desde una IP propia, para no compartir el límite nativo por IP entre pruebas. */
export async function sessionCookie(app: AuthApp["app"], email: string): Promise<string> {
  const ip = `10.${randomInt(1, 254)}.${randomInt(1, 254)}.${randomInt(1, 254)}`;
  const { status, cookie } = await signIn(app, email, PASSWORD, { "X-Forwarded-For": ip });
  if (status !== 200) throw new Error(`No se pudo iniciar sesión como ${email}: ${status}`);
  return cookie;
}

// Arnés HTTP del módulo taxpayer: la aplicación real con Better Auth, el contexto de petición de
// design D3 y los routers de usuarios, taxpayer y fiscal montados como en main.ts.
import type { JobStore } from "../../src/platform/jobs/jobs.ts";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Registry } from "@prometheus-io/client";
import { Router } from "express";
import {
  SHIPPING_GUIDE_LIMITS_DEFAULT,
  WITHHOLDING_LIMITS_DEFAULT,
  userSchemas,
  type ShippingGuideLimits,
  type WithholdingLimits,
} from "@facturador/contracts";
import {
  createAuthorizer,
  type Authorizer,
} from "../../src/modules/identity/application/authorization.ts";
import { createUserAdministration } from "../../src/modules/identity/application/user-administration.ts";
import { usersRouter } from "../../src/modules/identity/infrastructure/http/users-router.ts";
import { taxpayerRouters } from "../../src/modules/taxpayer/infrastructure/index.ts";
import {
  fiscalRouters,
  signingPipelines,
  type DocumentSigner,
} from "../../src/modules/fiscal/infrastructure/index.ts";
import {
  catalogsModule,
  fiscalCatalogQueries,
} from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  partiesModule,
  shippingPartyReader,
  supplierReader,
} from "../../src/modules/parties/infrastructure/index.ts";
import { productReader, productsModule } from "../../src/modules/products/infrastructure/index.ts";
import {
  inventoryInitialization,
  inventoryModule,
  inventoryStockReads,
  stockReturnCapacity,
} from "../../src/modules/inventory/infrastructure/index.ts";
import {
  invoiceCreditSource,
  invoiceSigningProfile,
  invoicesModule,
} from "../../src/modules/invoices/infrastructure/index.ts";
import {
  creditNoteSigningProfile,
  creditNotesModule,
} from "../../src/modules/credit-notes/infrastructure/index.ts";
import {
  debitNoteSigningProfile,
  debitNotesModule,
} from "../../src/modules/debit-notes/infrastructure/index.ts";
import {
  withholdingReceiptSigningProfile,
  withholdingReceiptsModule,
} from "../../src/modules/withholding-receipts/infrastructure/index.ts";
import {
  shippingGuideSigningProfile,
  shippingGuidesModule,
} from "../../src/modules/shipping-guides/infrastructure/index.ts";
import type { Permission } from "../../src/modules/identity/domain/access-policy.ts";
import { ForbiddenError } from "../../src/platform/http/errors.ts";
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

/** Notas de crédito (add-credit-notes): las opciones que la prueba fija. */
export type CreditNotesHarnessOptions = {
  accessKeys?: AccessKeys;
  /** false: la emisión se detiene en RESERVED (caída simulada después del commit). */
  signAfterReserve?: boolean;
  /** Firma de comprobantes; por defecto, la del módulo de firma configurado. */
  signer?: DocumentSigner;
  metrics?: Registry;
};

/** Notas de débito (add-debit-notes): las opciones que la prueba fija. */
export type DebitNotesHarnessOptions = {
  accessKeys?: AccessKeys;
  /** false: la emisión se detiene en RESERVED (caída simulada después del commit). */
  signAfterReserve?: boolean;
  /** Firma de comprobantes; por defecto, la del módulo de firma configurado. */
  signer?: DocumentSigner;
  metrics?: Registry;
  /** `EMISSION_STAGE_TIMINGS`: cabecera `Server-Timing` en la emisión. */
  stageTimings?: boolean;
};

/** Comprobantes de retención (add-withholding-receipts): las opciones que la prueba fija. */
export type WithholdingHarnessOptions = {
  /** Límites efectivos de recursos; los valores por defecto del entorno si no se fijan. */
  limits?: Partial<WithholdingLimits>;
  /**
   * Permisos que el autorizador de las retenciones niega: como los dos roles tienen los de la
   * consulta, el borrador y la emisión, el `403` se prueba con una política que no los concede.
   */
  deny?: readonly Permission[];
  accessKeys?: AccessKeys;
  /** false: la emisión se detiene en RESERVED (caída simulada después del commit). */
  signAfterReserve?: boolean;
  /** Firma de comprobantes; por defecto, la del módulo de firma configurado. */
  signer?: DocumentSigner;
  metrics?: Registry;
  /** `EMISSION_STAGE_TIMINGS`: cabecera `Server-Timing` en la emisión. */
  stageTimings?: boolean;
};

/** Guías de remisión (add-shipping-guides): las opciones que la prueba fija. */
export type ShippingGuidesHarnessOptions = {
  /** Límites efectivos de recursos; los valores por defecto del entorno si no se fijan. */
  limits?: Partial<ShippingGuideLimits>;
  /** Permisos que el autorizador de las guías niega, para probar el `403`. */
  deny?: readonly Permission[];
  accessKeys?: AccessKeys;
  /** false: la emisión se detiene en RESERVED (caída simulada después del commit). */
  signAfterReserve?: boolean;
  /** Firma de comprobantes; por defecto, la del módulo de firma configurado. */
  signer?: DocumentSigner;
  metrics?: Registry;
  /** `EMISSION_STAGE_TIMINGS`: cabecera `Server-Timing` en la emisión. */
  stageTimings?: boolean;
};

/** Un autorizador que niega además los permisos dados (los dos roles tienen los del borrador). */
function denying(authorizer: Authorizer, deny: readonly Permission[] | undefined): Authorizer {
  const denied = new Set(deny ?? []);
  return denied.size
    ? {
        ...authorizer,
        requirePermission: (ctx, permission) => {
          if (denied.has(permission)) throw new ForbiddenError();
          authorizer.requirePermission(ctx, permission);
        },
      }
    : authorizer;
}

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
    creditNotes?: CreditNotesHarnessOptions;
    debitNotes?: DebitNotesHarnessOptions;
    withholdingReceipts?: WithholdingHarnessOptions;
    shippingGuides?: ShippingGuidesHarnessOptions;
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
      // La firma es la compartida de `fiscal` con el perfil de la factura (add-credit-notes, D2).
      const invoicesNow = options.invoices?.now ?? options.now;
      const documentSigning = signingPipelines({
        prisma: db.database.prisma,
        xsd: options.invoices?.xsd ?? testXsdValidator(),
        signer: options.invoices?.signer ?? signing?.documents ?? NO_SIGNER,
        ...(options.invoices?.jobs ? { jobs: options.invoices.jobs } : {}),
        ...(invoicesNow ? { now: invoicesNow } : {}),
      });
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
          signing: documentSigning.pipeline(invoiceSigningProfile()),
          ...(options.invoices?.signAfterReserve === false ? { signAfterReserve: false } : {}),
          ...(options.invoices?.accessKeys ? { accessKeys: options.invoices.accessKeys } : {}),
          ...(options.invoices?.stageTimings ? { stageTimings: true } : {}),
          ...(options.invoices?.metrics ? { metrics: options.invoices.metrics } : {}),
          ...(options.invoices?.jobs ? { jobs: options.invoices.jobs } : {}),
          ...(invoicesNow ? { now: invoicesNow } : {}),
        }).routers,
      );
      // Notas de crédito (add-credit-notes): los mismos puertos que compone `main.ts`.
      const creditSigning = options.creditNotes?.signer
        ? signingPipelines({
            prisma: db.database.prisma,
            xsd: options.invoices?.xsd ?? testXsdValidator(),
            signer: options.creditNotes.signer,
            ...(options.invoices?.jobs ? { jobs: options.invoices.jobs } : {}),
            ...(invoicesNow ? { now: invoicesNow } : {}),
          })
        : documentSigning;
      router.use(
        ...creditNotesModule({
          prisma: db.database.prisma,
          schema: db.name,
          authorizer,
          signingReads: signing
            ? signing.reads
            : () => ({ activeCertificate: () => Promise.resolve(null) }),
          invoices: invoiceCreditSource,
          returns: stockReturnCapacity,
          xsd: options.invoices?.xsd ?? testXsdValidator(),
          signing: creditSigning.pipeline(creditNoteSigningProfile()),
          ...(options.creditNotes?.signAfterReserve === false ? { signAfterReserve: false } : {}),
          ...(options.creditNotes?.accessKeys
            ? { accessKeys: options.creditNotes.accessKeys }
            : {}),
          ...(options.creditNotes?.metrics ? { metrics: options.creditNotes.metrics } : {}),
          ...(invoicesNow ? { now: invoicesNow } : {}),
        }).routers,
      );
      // Notas de débito (add-debit-notes): los mismos puertos que compone `main.ts`.
      const debitSigning = options.debitNotes?.signer
        ? signingPipelines({
            prisma: db.database.prisma,
            xsd: options.invoices?.xsd ?? testXsdValidator(),
            signer: options.debitNotes.signer,
            ...(options.invoices?.jobs ? { jobs: options.invoices.jobs } : {}),
            ...(invoicesNow ? { now: invoicesNow } : {}),
          })
        : documentSigning;
      router.use(
        ...debitNotesModule({
          prisma: db.database.prisma,
          schema: db.name,
          authorizer,
          signingReads: signing
            ? signing.reads
            : () => ({ activeCertificate: () => Promise.resolve(null) }),
          invoices: invoiceCreditSource,
          xsd: options.invoices?.xsd ?? testXsdValidator(),
          signing: debitSigning.pipeline(debitNoteSigningProfile()),
          ...(options.invoices?.jobs ? { jobs: options.invoices.jobs } : {}),
          ...(options.debitNotes?.signAfterReserve === false ? { signAfterReserve: false } : {}),
          ...(options.debitNotes?.accessKeys ? { accessKeys: options.debitNotes.accessKeys } : {}),
          ...(options.debitNotes?.metrics ? { metrics: options.debitNotes.metrics } : {}),
          ...(options.debitNotes?.stageTimings ? { stageTimings: true } : {}),
          ...(invoicesNow ? { now: invoicesNow } : {}),
        }).routers,
      );
      // Comprobantes de retención (add-withholding-receipts): los mismos puertos que compone `main.ts`.
      const withholdingSigning = options.withholdingReceipts?.signer
        ? signingPipelines({
            prisma: db.database.prisma,
            xsd: options.invoices?.xsd ?? testXsdValidator(),
            signer: options.withholdingReceipts.signer,
            ...(options.invoices?.jobs ? { jobs: options.invoices.jobs } : {}),
            ...(invoicesNow ? { now: invoicesNow } : {}),
          })
        : documentSigning;
      const denied = new Set(options.withholdingReceipts?.deny ?? []);
      const withholdingAuthorizer: typeof authorizer = denied.size
        ? {
            ...authorizer,
            requirePermission: (ctx, permission) => {
              if (denied.has(permission)) throw new ForbiddenError();
              authorizer.requirePermission(ctx, permission);
            },
          }
        : authorizer;
      router.use(
        ...withholdingReceiptsModule({
          prisma: db.database.prisma,
          schema: db.name,
          authorizer: withholdingAuthorizer,
          signingReads: signing
            ? signing.reads
            : () => ({ activeCertificate: () => Promise.resolve(null) }),
          parties: supplierReader,
          limits: { ...WITHHOLDING_LIMITS_DEFAULT, ...options.withholdingReceipts?.limits },
          xsd: options.invoices?.xsd ?? testXsdValidator(),
          signing: withholdingSigning.pipeline(withholdingReceiptSigningProfile()),
          ...(options.invoices?.jobs ? { jobs: options.invoices.jobs } : {}),
          ...(options.withholdingReceipts?.signAfterReserve === false
            ? { signAfterReserve: false }
            : {}),
          ...(options.withholdingReceipts?.accessKeys
            ? { accessKeys: options.withholdingReceipts.accessKeys }
            : {}),
          ...(options.withholdingReceipts?.metrics
            ? { metrics: options.withholdingReceipts.metrics }
            : {}),
          ...(options.withholdingReceipts?.stageTimings ? { stageTimings: true } : {}),
          ...(invoicesNow ? { now: invoicesNow } : {}),
        }).routers,
      );
      // Guías de remisión (add-shipping-guides): los mismos puertos que compone `main.ts`.
      const shipping = options.shippingGuides;
      const shippingSigning = shipping?.signer
        ? signingPipelines({
            prisma: db.database.prisma,
            xsd: options.invoices?.xsd ?? testXsdValidator(),
            signer: shipping.signer,
            ...(options.invoices?.jobs ? { jobs: options.invoices.jobs } : {}),
            ...(invoicesNow ? { now: invoicesNow } : {}),
          })
        : documentSigning;
      router.use(
        ...shippingGuidesModule({
          prisma: db.database.prisma,
          schema: db.name,
          authorizer: denying(authorizer, shipping?.deny),
          signingReads: signing
            ? signing.reads
            : () => ({ activeCertificate: () => Promise.resolve(null) }),
          parties: shippingPartyReader,
          products: productReader,
          invoices: invoiceCreditSource,
          limits: { ...SHIPPING_GUIDE_LIMITS_DEFAULT, ...shipping?.limits },
          xsd: options.invoices?.xsd ?? testXsdValidator(),
          signing: shippingSigning.pipeline(shippingGuideSigningProfile()),
          ...(options.invoices?.jobs ? { jobs: options.invoices.jobs } : {}),
          ...(shipping?.signAfterReserve === false ? { signAfterReserve: false } : {}),
          ...(shipping?.accessKeys ? { accessKeys: shipping.accessKeys } : {}),
          ...(shipping?.metrics ? { metrics: shipping.metrics } : {}),
          ...(shipping?.stageTimings ? { stageTimings: true } : {}),
          ...(invoicesNow ? { now: invoicesNow } : {}),
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

// Arranque y apagado del backend. Desarrollo: node --conditions=development src/main.ts (ADR 0016).
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { userSchemas } from "@facturador/contracts";
import { Router } from "express";
import { createApp } from "./app.ts";
import {
  EnvError,
  loadCertificateCustody,
  loadEnv,
  loadInitialAdmin,
  passwordPolicy,
  SRI_ENDPOINT_VARIABLES,
  type Env,
} from "./config/env.ts";
import { createAuthorizer } from "./modules/identity/application/authorization.ts";
import { provisionInstallation } from "./modules/identity/application/provisioning.ts";
import { createUserAdministration } from "./modules/identity/application/user-administration.ts";
import {
  authSettingsFromEnv,
  createAuth,
  createUnitOfWork,
  getSessionUserId,
  mountAuth,
} from "./modules/identity/infrastructure/better-auth/index.ts";
import { requireContext } from "./modules/identity/infrastructure/http/request-context.ts";
import { usersRouter } from "./modules/identity/infrastructure/http/users-router.ts";
import {
  catalogsModule,
  ecuadorDate,
  fiscalCatalogQueries,
  loadInstalledFiscalCatalogs,
} from "./modules/catalogs/infrastructure/index.ts";
import {
  consumerFinalInitializer,
  ensureConsumerFinals,
  partiesModule,
} from "./modules/parties/infrastructure/index.ts";
import { productsModule } from "./modules/products/infrastructure/index.ts";
import {
  createStockRepository,
  creditNoteReturnFollower,
  inventoryInitialization,
  inventoryModule,
  inventoryOutflowFollower,
  inventoryStockReads,
  registerInventoryMetrics,
  stockReturnCapacity,
  stockReturnReservations,
} from "./modules/inventory/infrastructure/index.ts";
import {
  invoiceCreditSource,
  invoiceSigningProfile,
  invoiceStockLines,
  invoicesModule,
} from "./modules/invoices/infrastructure/index.ts";
import {
  createCreditCapacityRepository,
  creditCapacityFollower,
  creditNoteSigningProfile,
  creditNotesModule,
} from "./modules/credit-notes/infrastructure/index.ts";
import {
  createConfigurationLogoReader,
  taxpayerRouters,
} from "./modules/taxpayer/infrastructure/index.ts";
import { debitNotesModule } from "./modules/debit-notes/infrastructure/index.ts";
import { fiscalRouters, signingPipelines } from "./modules/fiscal/infrastructure/index.ts";
import {
  SRI_JOB_TYPES,
  createArtifactStore,
  createAuthorizeHandler,
  createDocumentRepository,
  createReconcileHandler,
  createSriEvidenceRepository,
  createTransmissionSweeper,
  createTransmissionUnitOfWork,
  createTransmitHandler,
  registerTransmissionMetrics,
} from "./modules/fiscal/infrastructure/index.ts";
import { createTransmissionGate } from "./modules/fiscal/infrastructure/transmission-gate.ts";
import {
  DOCUMENT_JOB_PREFIX,
  RIDE_JOB_TYPE,
  archiveRouters,
  createRideHandler,
  createRideSweeper,
  createRideUnitOfWork,
  registerRideMetrics,
  rideFollower,
} from "./modules/fiscal/infrastructure/archive/index.ts";
import { rideSettingsFromEnv } from "./config/archive.ts";
import { transmissionSettingsFromEnv } from "./config/transmission.ts";
import {
  createCircuitBreaker,
  createPooledRideRenderer,
  createSoapTransport,
  createSriGateway,
  createXmllintXsdValidator,
  defaultRideFontsDirectory,
  endpointsValid,
  resolveSriEndpoints,
  rideTasksEntry,
  sriClassifiers,
  verifyRideAssets,
  verifySchemaBundle,
} from "./modules/sri-engine/infrastructure/index.ts";
import {
  certificateTasksEntry,
  isSigningCertificateUpload,
  signingModule,
} from "./modules/signing/infrastructure/index.ts";
import { createCompanyReader } from "./modules/identity/infrastructure/prisma-companies.ts";
import { createMembershipReader } from "./modules/identity/infrastructure/prisma-memberships.ts";
import { createSecurityEventLog } from "./modules/identity/infrastructure/security-event-log.ts";
import { createDatabase, parseDatabaseUrl } from "./platform/db/database.ts";
import { createPrismaJobStore } from "./platform/jobs/prisma-job-store.ts";
import { createJobRunner } from "./platform/jobs/runner.ts";
import { createShutdown, type Closer } from "./platform/lifecycle/shutdown.ts";
import { createLogger } from "./platform/logging/logger.ts";
import { createMetrics } from "./platform/metrics/metrics.ts";
import { createCryptoWorkerPool } from "./platform/workers/crypto-worker-pool.ts";
import { createRideWorkerPool } from "./platform/workers/ride-worker-pool.ts";

function loadEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = loadEnvOrExit();
// Sin la clave maestra de la custodia, la API no arranca (ADR 0011, design D6).
const certificateCustody = (() => {
  try {
    return loadCertificateCustody(env);
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
})();
const logger = createLogger(env.LOG_LEVEL);
logger.info(
  certificateCustody.enabled
    ? { certificateCustody: "enabled", keyVersion: certificateCustody.keyVersion }
    : { certificateCustody: "disabled" },
  "custodia de firmas",
);
const database = createDatabase(env.DATABASE_URL);
const closers: Closer[] = [{ name: "database", close: database.close }];

const metrics = createMetrics();
const securityEvents = createSecurityEventLog(logger, metrics.registry);
const authSettings = authSettingsFromEnv(env);
const auth = createAuth({ prisma: database.prisma, settings: authSettings, securityEvents });
const catalogQueries = fiscalCatalogQueries(database.prisma);
// Toda empresa nueva confirma con su consumidor final (add-parties-and-products, design D5).
const uow = createUnitOfWork(database.prisma, auth, authSettings, [
  consumerFinalInitializer({ policies: catalogQueries }),
]);
const memberships = createMembershipReader(database.prisma);

// Catálogos fiscales oficiales de la versión instalada (add-fiscal-catalogs, design D3): se aplican
// antes de aceptar tráfico; un dataset inválido o en conflicto impide arrancar. Van antes del
// aprovisionamiento: el consumidor final de una empresa nueva sale de su política (design D5 de
// add-parties-and-products), y cargarlos no depende de ninguna empresa.
try {
  const report = await loadInstalledFiscalCatalogs(database.prisma);
  logger.info(
    {
      applied: report.applied.map((d) => `${d.catalogType}@${d.version}:+${d.newEntries}`),
      alreadyApplied: report.alreadyApplied.length,
    },
    "catálogos fiscales cargados",
  );
} catch (error) {
  logger.fatal({ err: error }, "no se pudieron cargar los catálogos fiscales");
  await database.close();
  process.exit(1);
}

// Aprovisionamiento antes de aceptar tráfico (design D7).
try {
  const result = await provisionInstallation({
    uow,
    companies: createCompanyReader(database.prisma),
    initialAdmin: () => loadInitialAdmin(env),
    correlationId: `startup-${randomUUID()}`,
  });
  if (result === "provisioned")
    logger.info("instalación aprovisionada: empresa y administrador inicial creados");
} catch (error) {
  if (error instanceof EnvError) console.error(error.message);
  else logger.fatal({ err: error }, "el aprovisionamiento falló");
  await database.close();
  process.exit(1);
}

// Reposición del consumidor final de las empresas que no lo tengan, por ejemplo las anteriores a
// add-parties-and-products (design D5, casos A y C). Idempotente; si queda alguna empresa sin él,
// el sistema no arranca.
try {
  const { created } = await ensureConsumerFinals({
    db: database.prisma,
    policies: catalogQueries,
    companyIds: () => createCompanyReader(database.prisma).listIds(),
  });
  if (created > 0) logger.info({ created }, "consumidores finales repuestos");
} catch (error) {
  logger.fatal({ err: error }, "no se pudo garantizar el consumidor final de cada empresa");
  await database.close();
  process.exit(1);
}

// Paquete de XSD del registro de esquemas (add-invoice-emission, design D11): en el build,
// `dist/xsd/`; en desarrollo y pruebas, `docs/product/`, donde las rutas lógicas coinciden. Si al
// arrancar falta un XSD o un import, o un hash no coincide, el backend no se declara listo.
const xsdValidator = createXmllintXsdValidator({
  root:
    env.XSD_DIRECTORY ??
    fileURLToPath(
      new URL(import.meta.url.endsWith(".ts") ? "../../docs/product/" : "./xsd/", import.meta.url),
    ),
  concurrency: env.XSD_VALIDATION_CONCURRENCY,
  maxQueue: env.XSD_VALIDATION_QUEUE,
  timeoutMs: env.XSD_VALIDATION_TIMEOUT_MS,
});
const xsdBundleAvailable = await verifySchemaBundle({
  validator: xsdValidator,
  registry: () => catalogQueries.schemaRegistry(),
  metrics: metrics.registry,
  logger,
});

// Fuentes del RIDE (add-document-archive, design D7): en el build, `dist/assets/fonts/noto-sans/`;
// en desarrollo y pruebas, `assets/fonts/noto-sans/`. Si falta un archivo o un hash no coincide,
// el RIDE no está listo: /health/ready responde 503 con su propio detalle, distinto del de los XSD.
const rideFontsDirectory = env.RIDE_FONTS_DIRECTORY ?? defaultRideFontsDirectory();
const rideAssetsAvailable = verifyRideAssets({
  directory: rideFontsDirectory,
  metrics: metrics.registry,
  logger,
});

// Toda ruta de /api/v1 exige sesión y membresía activa; el contexto se resuelve en el servidor (D3).
const apiRouter = Router();
apiRouter.use(
  requireContext({ getSessionUserId: (headers) => getSessionUserId(auth, headers), memberships }),
);
const authorizer = createAuthorizer({ memberships, securityEvents });
// Inspección y firma fuera del event loop (add-signing-certificate, design D18). Se cierra antes que
// la base de datos.
const cryptoPool = createCryptoWorkerPool({
  entry: certificateTasksEntry(),
  size: env.CRYPTO_WORKERS,
  timeoutMs: env.CRYPTO_TASK_TIMEOUT_MS,
  logger,
});
closers.unshift({ name: "crypto-pool", close: () => cryptoPool.close() });
const signing = signingModule({
  prisma: database.prisma,
  authorizer,
  custody: certificateCustody,
  maxBytes: env.CERTIFICATE_MAX_BYTES,
  pool: cryptoPool,
  metrics: metrics.registry,
});
apiRouter.use(
  usersRouter(
    createUserAdministration({
      uow,
      memberships,
      authorizer,
      schemas: userSchemas(passwordPolicy(env)),
    }),
  ),
);
apiRouter.use(
  ...taxpayerRouters({
    prisma: database.prisma,
    authorizer,
    logoMaxBytes: env.LOGO_MAX_BYTES,
    signingCertificate: signing.readiness,
  }),
);
apiRouter.use(...fiscalRouters({ prisma: database.prisma, authorizer }));
apiRouter.use(...signing.routers);
apiRouter.use(...catalogsModule({ prisma: database.prisma, authorizer }).routers);
apiRouter.use(
  ...partiesModule({ prisma: database.prisma, authorizer, rules: catalogQueries }).routers,
);
apiRouter.use(
  ...productsModule({
    prisma: database.prisma,
    authorizer,
    catalogs: catalogQueries,
    // add-minimal-inventory, design D7: la marca de un producto con inventario la cambia el inventario.
    inventoryInitialization,
  }).routers,
);
// Inventario contabilizado por hechos fiscales autorizados (add-minimal-inventory, design D10). Sus
// métricas se registran una vez: las comparten las operaciones del inventario y la salida al autorizar.
const inventoryMetrics = registerInventoryMetrics(metrics.registry, { prisma: database.prisma });
apiRouter.use(
  ...inventoryModule({ prisma: database.prisma, authorizer, observer: inventoryMetrics }).routers,
);
// Cola durable de jobs (ADR 0012): la usan los workers, la firma y la reconciliación manual.
const jobStore = createPrismaJobStore(database.prisma, parseDatabaseUrl(env.DATABASE_URL).schema);
const transmissionSettings = transmissionSettingsFromEnv(env);
const rideSettings = rideSettingsFromEnv(env);

// Bandeja de comprobantes y sus documentos (add-document-archive, design D2, D5, D8 a D10).
apiRouter.use(
  ...archiveRouters({
    prisma: database.prisma,
    authorizer,
    jobs: jobStore,
    rideSettings: rideSettings.job,
    metrics: metrics.registry,
    logger,
  }),
);

// Firma de comprobantes compartida por tipo (add-credit-notes, design D2): cada módulo que emite
// pide su pipeline con su perfil.
const documentSigning = signingPipelines({
  prisma: database.prisma,
  xsd: xsdValidator,
  signer: signing.documents,
  jobs: jobStore,
  transmission: transmissionSettings,
  logger,
});

// Borradores y facturas (add-invoice-emission, design D1 y D13).
apiRouter.use(
  ...invoicesModule({
    prisma: database.prisma,
    authorizer,
    signingReads: signing.reads,
    // add-minimal-inventory, design D1 y D4: la decisión de inventario de cada línea al reservar.
    stockReads: inventoryStockReads,
    xsd: xsdValidator,
    signing: documentSigning.pipeline(invoiceSigningProfile()),
    maxLines: env.INVOICE_MAX_LINES,
    metrics: metrics.registry,
    stageTimings: env.EMISSION_STAGE_TIMINGS,
    logger,
    jobs: jobStore,
    conclusionWindowMs: transmissionSettings.poll.windowMs,
  }).routers,
);

// Notas de crédito (add-credit-notes, design D1 y D16): la factura de origen de `invoices`, la
// capacidad devolvible de `inventory` y la firma compartida con el perfil de la nota, como puertos.
apiRouter.use(
  ...creditNotesModule({
    prisma: database.prisma,
    schema: parseDatabaseUrl(env.DATABASE_URL).schema ?? "public",
    authorizer,
    signingReads: signing.reads,
    invoices: invoiceCreditSource,
    returns: stockReturnCapacity,
    xsd: xsdValidator,
    signing: documentSigning.pipeline(creditNoteSigningProfile()),
    metrics: metrics.registry,
    jobs: jobStore,
    conclusionWindowMs: transmissionSettings.poll.windowMs,
    stageTimings: env.EMISSION_STAGE_TIMINGS,
  }).routers,
);

// Notas de débito (add-debit-notes, design D1 y D20): la factura de origen de `invoices` como
// puerto, sin capacidades ni inventario.
apiRouter.use(
  ...debitNotesModule({
    prisma: database.prisma,
    schema: parseDatabaseUrl(env.DATABASE_URL).schema ?? "public",
    authorizer,
    signingReads: signing.reads,
    invoices: invoiceCreditSource,
  }).routers,
);

// Transmisión al SRI (add-sri-transmission, design D5): nace deshabilitada. El estado se registra
// sin secretos ni URLs; habilitada, la readiness exige sus precondiciones.
const sriEndpoints = resolveSriEndpoints(env);
const transmissionGate = createTransmissionGate(
  {
    enabled: env.SRI_TRANSMISSION_ENABLED,
    workers: env.SRI_JOB_WORKERS,
    endpointsValid: () => endpointsValid(sriEndpoints, env.NODE_ENV === "production"),
    // La política de tamaño se resuelve con la fecha del envío; aquí, con la de hoy (design D17).
    sizePolicyAvailable: async () =>
      (await catalogQueries.sriTransmissionSizePolicy(ecuadorDate(new Date()))) !== null,
  },
  { logger, registry: metrics.registry },
);
logger.info(
  {
    sriTransmission: env.SRI_TRANSMISSION_ENABLED ? "enabled" : "disabled",
    workers: env.SRI_JOB_WORKERS,
    endpointOverrides: SRI_ENDPOINT_VARIABLES.filter((name) => env[name] !== undefined).length,
  },
  "transmisión al SRI",
);
await transmissionGate.refresh();
setInterval(() => void transmissionGate.refresh(), 30_000).unref();

// Transporte SOAP propio y handlers de la transmisión (add-sri-transmission, design D6 a D17). El
// único camino al SRI; con la transmisión deshabilitada sus jobs no se toman.
const sriBreaker = createCircuitBreaker({
  failures: env.SRI_BREAKER_FAILURES,
  cooldownMs: env.SRI_BREAKER_COOLDOWN_SECONDS * 1_000,
});
const sriGateway = createSriGateway({
  transport: createSoapTransport({
    endpoints: sriEndpoints,
    requestTimeoutMs: env.SRI_REQUEST_TIMEOUT_MS,
    bodyTimeoutMs: env.SRI_BODY_TIMEOUT_MS,
    maxResponseBytes: env.SRI_RESPONSE_MAX_BYTES,
  }),
  breaker: sriBreaker,
});
const stepDependencies = {
  db: database.prisma,
  evidence: createSriEvidenceRepository(database.prisma),
  uow: createTransmissionUnitOfWork(database.prisma),
  jobs: jobStore,
  logger,
  // Seguidores de las transiciones (add-document-archive, design D5; add-minimal-inventory, design
  // D5; add-credit-notes, design D7, D8, D10 y D25): al autorizar, el job del RIDE y la salida de
  // inventario de una factura nacen en la misma transacción; la nota de crédito aplica o libera su
  // capacidad acreditable y, después, su capacidad devolvible con la DEVOLUCION_NC. La transmisión
  // no conoce el archivo documental, el inventario ni las notas de crédito.
  followers: [
    rideFollower({ jobs: jobStore, settings: rideSettings.job }),
    inventoryOutflowFollower({
      invoices: invoiceStockLines,
      stock: createStockRepository,
      onOutflow: () => inventoryMetrics.movement("SALIDA_FACTURA"),
    }),
    creditCapacityFollower({ capacity: createCreditCapacityRepository }),
    creditNoteReturnFollower({
      returns: stockReturnReservations,
      stock: createStockRepository,
      documents: createDocumentRepository,
      onReturn: () => inventoryMetrics.movement("DEVOLUCION_NC"),
    }),
  ],
  observer: registerTransmissionMetrics(metrics.registry, {
    prisma: database.prisma,
    breakerState: (environment, service) => sriBreaker.state(environment, service),
  }),
};
const transmitHandler = createTransmitHandler({
  ...stepDependencies,
  documents: createDocumentRepository(database.prisma),
  artifacts: createArtifactStore(database.prisma),
  sizePolicy: (date) => catalogQueries.sriTransmissionSizePolicy(date),
  gateway: sriGateway,
  classifiers: sriClassifiers,
  settings: transmissionSettings,
  today: ecuadorDate,
  alert: (details, message) => logger.error(details, message),
});
const authorizeHandler = createAuthorizeHandler({
  ...stepDependencies,
  documents: createDocumentRepository(database.prisma),
  gateway: sriGateway,
  classifiers: sriClassifiers,
  settings: transmissionSettings,
});
const reconcileHandler = createReconcileHandler({
  ...stepDependencies,
  documents: createDocumentRepository(database.prisma),
  inquiry: sriGateway,
  classifiers: sriClassifiers,
  settings: transmissionSettings,
}).handler;
// Barrido de los firmados sin job: al arrancar y periódico, también con la transmisión apagada.
const transmissionSweeper = createTransmissionSweeper({
  prisma: database.prisma,
  jobs: jobStore,
  settings: transmissionSettings,
  logger,
});
closers.unshift({ name: "transmission-sweeper", close: () => transmissionSweeper.close() });

// Cola durable de jobs (ADR 0012): los workers corren en el proceso de la API y se cierran antes
// que el pool criptográfico y la base de datos.
const jobRunner = createJobRunner({
  store: jobStore,
  db: database.prisma,
  handlers: {
    [SRI_JOB_TYPES.transmit]: transmitHandler,
    [SRI_JOB_TYPES.authorize]: authorizeHandler,
    [SRI_JOB_TYPES.reconcile]: reconcileHandler,
  },
  workers: env.SRI_JOB_WORKERS,
  pollIntervalMs: env.SRI_JOB_POLL_INTERVAL_MS,
  leaseMs: env.SRI_JOB_LEASE_SECONDS * 1_000,
  pausedPrefixes: transmissionGate.pausedPrefixes,
  logger,
});
closers.unshift({ name: "jobs", close: jobRunner.close });

// RIDE (add-document-archive, design D5 y D6): su pool de workers, su handler, su barrido y su
// propio runner para los jobs `document.*`. El interruptor de la transmisión no lo pausa; sin las
// fuentes verificadas no toma jobs. Se cierra antes que su pool, y este antes que la base.
const ridePool = createRideWorkerPool({
  entry: rideTasksEntry(),
  size: rideSettings.workers,
  maxQueue: rideSettings.queue,
  timeoutMs: rideSettings.taskTimeoutMs,
  fontsDirectory: rideFontsDirectory,
  logger,
});
closers.unshift({ name: "ride-pool", close: () => ridePool.close() });
const rideHandler = createRideHandler({
  db: database.prisma,
  documents: createDocumentRepository(database.prisma),
  artifacts: createArtifactStore(database.prisma),
  logos: createConfigurationLogoReader(database.prisma),
  renderer: createPooledRideRenderer(ridePool),
  uow: createRideUnitOfWork(database.prisma),
  jobs: jobStore,
  settings: rideSettings.job,
  observer: registerRideMetrics(metrics.registry, { prisma: database.prisma }),
  logger,
});
const rideSweeper = createRideSweeper({
  prisma: database.prisma,
  jobs: jobStore,
  settings: rideSettings.job,
  logger,
});
closers.unshift({ name: "ride-sweeper", close: () => rideSweeper.close() });
const rideRunner = createJobRunner({
  store: jobStore,
  db: database.prisma,
  handlers: { [RIDE_JOB_TYPE]: rideHandler },
  workers: rideSettings.workers,
  pollIntervalMs: rideSettings.pollIntervalMs,
  leaseMs: rideSettings.leaseMs,
  pausedPrefixes: () => (rideAssetsAvailable ? [] : [DOCUMENT_JOB_PREFIX]),
  logger,
});
closers.unshift({ name: "ride-jobs", close: rideRunner.close });

const app = createApp({
  logger,
  metrics,
  readiness: async () => {
    const transmission = await transmissionGate.refresh();
    return {
      ready:
        xsdBundleAvailable &&
        rideAssetsAvailable &&
        (await database.ping()) &&
        cryptoPool.isRunning() &&
        ridePool.isRunning() &&
        transmission.ready,
      details: {
        sriTransmission: transmission.enabled ? "enabled" : "disabled",
        rideAssets: rideAssetsAvailable ? "available" : "unavailable",
      },
    };
  },
  trustProxy: env.TRUST_PROXY,
  apiRouter,
  mountBeforeBodyParser: (express) => mountAuth(express, auth, securityEvents),
  jsonBodyExceptions: isSigningCertificateUpload,
});

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "backend escuchando");
});
jobRunner.start();
void transmissionSweeper.sweep().then(
  (created) => {
    if (created > 0) logger.info({ created }, "barrido de la transmisión al arrancar");
  },
  (error: unknown) => logger.error({ err: error }, "el barrido de la transmisión falló"),
);
transmissionSweeper.start(env.SRI_SWEEP_INTERVAL_SECONDS * 1_000);
rideRunner.start();
void rideSweeper.sweep().then(
  (created) => {
    if (created > 0) logger.info({ created }, "barrido del RIDE al arrancar");
  },
  (error: unknown) => logger.error({ err: error }, "el barrido del RIDE falló"),
);
rideSweeper.start(rideSettings.sweepIntervalMs);

// Firmas vigentes que la clave de custodia configurada no abre: figuran como no disponibles hasta
// volver a cargarlas (design D8). Sin secretos en el registro.
void signing.service.unopenable().then(
  (certificates) => {
    for (const certificate of certificates) {
      logger.error(
        { companyId: certificate.companyId, certificateId: certificate.id },
        "la firma vigente no se puede abrir con la clave de custodia configurada",
      );
    }
  },
  (error: unknown) =>
    logger.error({ err: error }, "no se pudo comprobar la custodia de las firmas"),
);

const shutdown = createShutdown({ server, closers, logger });
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0));
  });
}

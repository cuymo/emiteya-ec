// Handler `document.render_ride` (add-document-archive, design D3 a D5): genera el RIDE una vez
// desde la fuente canónica, con su procedencia y sus versiones; nunca desde datos vigentes; se
// detiene con su motivo ante una fuente, una autorización o un logo que no corresponden; reintenta
// los fallos operativos; y el comprobante sigue autorizado en todos los casos.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import {
  RIDE_BACKOFF,
  RIDE_JOB_TYPE,
  rideJob,
} from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createRideHandler } from "../../src/modules/fiscal/application/archive/ride-handler.ts";
import { createRideUnitOfWork } from "../../src/modules/fiscal/infrastructure/archive/ride-unit-of-work.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import {
  RideRenderUnavailableError,
  type RideRenderInput,
  type RideRenderer,
} from "../../src/modules/sri-engine/application/ride.ts";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import {
  RIDE_VERSIONS,
  createInProcessRideRenderer,
} from "../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { createConfigurationLogoReader } from "../../src/modules/taxpayer/infrastructure/prisma-configuration-assets.ts";
import type { Job } from "../../src/platform/jobs/jobs.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { pngBytes } from "../fixtures/images.ts";
import { pageTexts } from "../support/pdf-inspection.ts";
import { INVOICE_CASES, type InvoiceCase } from "../support/ride-invoices.ts";
import {
  corruptArtifact,
  insertArchiveDocument,
  nextInvoice,
  sha256,
  type ArchiveDocument,
} from "./archive-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { leasedJob } from "./transmission-harness.ts";

const p12Dir = inject("p12FixturesDir");
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const realRenderer = createInProcessRideRenderer(assets.fonts);
const SETTINGS = { maxAttempts: 3, backoff: RIDE_BACKOFF };

describe("handler document.render_ride", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;

  const handler = (renderer: RideRenderer = realRenderer) =>
    createRideHandler({
      db: prisma,
      documents: createDocumentRepository(prisma),
      artifacts: createArtifactStore(prisma),
      logos: createConfigurationLogoReader(prisma),
      renderer,
      uow: createRideUnitOfWork(prisma),
      jobs: store,
      settings: SETTINGS,
      logger: { info: () => {}, warn: () => {} },
      random: () => 0.5,
    });
  const context = () => ({ signal: new AbortController().signal, now: () => new Date() });
  const jobFor = (document: { id: string; companyId: string }): Promise<Job> =>
    leasedJob(store, prisma, rideJob(document, SETTINGS, new Date()));
  const jobOf = (id: string) => prisma.job.findUniqueOrThrow({ where: { id } });
  const stateOf = async (id: string) =>
    (await prisma.electronicDocument.findUniqueOrThrow({ where: { id } })).state;
  const rides = (documentId: string) =>
    prisma.documentArtifact.findMany({ where: { documentId, kind: "RIDE_PDF" } });
  const authorizedDocument = async (
    options: Parameters<typeof insertArchiveDocument>[3] = {},
    base: InvoiceCase = INVOICE_CASES.oneLine,
  ): Promise<ArchiveDocument> =>
    insertArchiveDocument(prisma, company, await nextInvoice(p12Dir, base), options);
  /** Renderer falso que lanza un fallo operativo, o devuelve lo que se le indique. */
  const failing = (
    reason: ConstructorParameters<typeof RideRenderUnavailableError>[0],
  ): RideRenderer => ({
    render: () => Promise.reject(new RideRenderUnavailableError(reason)),
  });

  beforeAll(async () => {
    db = await createMigratedSchema("ride_handler");
    prisma = db.database.prisma;
    store = createPrismaJobStore(prisma, db.name);
    company = await insertFiscalCompany(prisma, "Empresa RIDE", 1);
  });

  afterAll(async () => {
    await db.drop();
  });

  describe("generación una vez", () => {
    it("guarda el RIDE con sus bytes, hash, tamaño, tipo, versiones y origen AUTHORIZED_XML", async () => {
      const document = await authorizedDocument();
      const job = await jobFor(document);
      await handler().run(job, context());
      const [ride] = await rides(document.id);
      expect(ride).toBeDefined();
      const content = Buffer.from(ride!.content);
      expect(ride).toMatchObject({
        mediaType: "application/pdf",
        sizeBytes: content.length,
        sha256: sha256(content),
      });
      expect(content.subarray(0, 5).toString()).toBe("%PDF-");
      const authorizedXml = await prisma.documentArtifact.findFirstOrThrow({
        where: { documentId: document.id, kind: "AUTHORIZED_XML" },
      });
      expect(ride!.metadata).toEqual({
        ...RIDE_VERSIONS,
        pages: 1,
        source: {
          kind: "AUTHORIZED_XML",
          sha256: authorizedXml.sha256,
          provenance: "AUTHORIZED_XML",
        },
        logo: null,
        authorizationNumber: document.accessKey,
        jobId: job.id,
      });
      expect((await jobOf(job.id)).status).toBe("DONE");
      expect(await stateOf(document.id)).toBe("AUTHORIZED");
    });

    it("sin XML autorizado sale del XML firmado transmitido, con procedencia de respaldo", async () => {
      const document = await authorizedDocument({ authorizedXml: false });
      await handler().run(await jobFor(document), context());
      const [ride] = await rides(document.id);
      const signed = await prisma.documentArtifact.findFirstOrThrow({
        where: { documentId: document.id, kind: "SIGNED_XML" },
      });
      expect(ride!.metadata).toMatchObject({
        source: { kind: "SIGNED_XML", sha256: signed.sha256, provenance: "SIGNED_XML_FALLBACK" },
      });
      const text = (await pageTexts(ride!.content)).join(" ");
      expect(text).toContain(`NÚMERO DE AUTORIZACIÓN ${document.accessKey}`);
    });

    it("con un RIDE guardado, una generación repetida termina sin generar otro", async () => {
      const document = await authorizedDocument();
      await handler().run(await jobFor(document), context());
      const [first] = await rides(document.id);
      const job = await jobFor(document);
      await handler({
        render: () => Promise.reject(new Error("no debe dibujar")),
      }).run(job, context());
      expect((await jobOf(job.id)).status).toBe("DONE");
      expect((await rides(document.id)).map((ride) => ride.id)).toEqual([first!.id]);
    });

    it("si otra ejecución guarda el RIDE mientras se dibuja, queda un solo RIDE", async () => {
      const document = await authorizedDocument();
      const job = await jobFor(document);
      let other: string | undefined;
      // Mientras este render está en curso, otra ejecución guarda su RIDE.
      const racing: RideRenderer = {
        async render(input: RideRenderInput) {
          const outcome = await realRenderer.render(input);
          other = (
            await createArtifactStore(prisma).save({
              companyId: document.companyId,
              documentId: document.id,
              kind: "RIDE_PDF",
              mediaType: "application/pdf",
              content: Buffer.from(outcome.status === "RENDERED" ? outcome.pdf : []),
              metadata: { otraEjecucion: true },
            })
          ).id;
          return outcome;
        },
      };
      await handler(racing).run(job, context());
      expect((await rides(document.id)).map((ride) => ride.id)).toEqual([other]);
      expect((await jobOf(job.id)).status).toBe("DONE");
    });
  });

  describe("fuente canónica y datos inmutables", () => {
    it("usa la denominación del snapshot y nunca datos vigentes", async () => {
      const document = await authorizedDocument({
        paymentLabels: { "01": "DENOMINACIÓN GUARDADA EN EL SNAPSHOT" },
      });
      // El tercero del comprador cambia después de autorizar: el RIDE no lo lee.
      const { buyer } = document.invoice.snapshot;
      const party = await prisma.party.create({
        data: {
          companyId: company.companyId,
          identificationType: buyer.identificationType,
          identification: buyer.identification,
          legalName: buyer.legalName,
          roles: ["CUSTOMER"],
          searchName: buyer.legalName.toLowerCase(),
          searchIdentification: buyer.identification,
          createdBy: company.adminId,
          updatedBy: company.adminId,
        },
      });
      await prisma.party.update({
        where: { id: party.id },
        data: { legalName: "NOMBRE VIGENTE CAMBIADO", version: { increment: 1 } },
      });
      await handler().run(await jobFor(document), context());
      const [ride] = await rides(document.id);
      const text = (await pageTexts(ride!.content)).join(" ");
      expect(text).toContain("01 - DENOMINACIÓN GUARDADA EN EL SNAPSHOT");
      expect(text).toContain(document.invoice.snapshot.buyer.legalName);
      expect(text).not.toContain("NOMBRE VIGENTE CAMBIADO");
    });

    it("el código del job no lee terceros, productos, configuración vigente ni catálogos", () => {
      const root = fileURLToPath(new URL("../../src/modules/fiscal/", import.meta.url));
      const files = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const path = join(dir, name);
          return statSync(path).isDirectory() ? files(path) : [path];
        });
      const archive = files(root).filter((path) => /\/archive\//.test(path));
      expect(archive.length).toBeGreaterThan(0);
      for (const path of archive) {
        const content = readFileSync(path, "utf8");
        expect(content, relative(root, path)).not.toMatch(
          /\.(?:party|product|productTax|companyConfig|companyConfigVersion|fiscalCatalogEntry|fiscalCatalogKey)\.|\/(?:parties|products|taxpayer|catalogs)\//,
        );
      }
    });

    it("dibuja el logo de la versión de configuración del snapshot, con su hash", async () => {
      const logo = pngBytes(40, 20, 3);
      const asset = await prisma.configurationAsset.create({
        data: {
          companyId: company.companyId,
          kind: "LOGO",
          mimeType: "image/png",
          sizeBytes: logo.length,
          sha256: sha256(logo),
          content: new Uint8Array(logo),
          createdById: company.adminId,
        },
      });
      const version = await prisma.companyConfigVersion.create({
        data: {
          companyId: company.companyId,
          version: 1,
          ruc: "1790012345001",
          legalName: "COMERCIAL ANDINA S.A.",
          headOfficeAddress: "Av. Amazonas N24-03, Quito",
          accountingRequired: true,
          largeTaxpayer: false,
          environment: "TEST",
          logoAssetId: asset.id,
          createdById: company.adminId,
        },
      });
      const document = await authorizedDocument({ configVersionId: version.id });
      await handler().run(await jobFor(document), context());
      const [ride] = await rides(document.id);
      expect(ride!.metadata).toMatchObject({ logo: { sha256: sha256(logo) } });
      expect(Buffer.from(ride!.content).toString("latin1")).toContain("/Subtype /Image");
    });
  });

  describe("detenciones deterministas, con el comprobante autorizado", () => {
    it("un documento de origen alterado se detiene con RIDE_SOURCE_INTEGRITY", async () => {
      const document = await authorizedDocument();
      await corruptArtifact(prisma, db.name, document.id, "AUTHORIZED_XML");
      const job = await jobFor(document);
      await handler().run(job, context());
      expect(await jobOf(job.id)).toMatchObject({
        status: "STOPPED",
        lastErrorCode: "RIDE_SOURCE_INTEGRITY",
        lastErrorClass: "INTEGRITY",
      });
      expect(await rides(document.id)).toEqual([]);
      expect(await stateOf(document.id)).toBe("AUTHORIZED");
    });

    it("una autorización que no corresponde se detiene con RIDE_AUTHORIZATION_MISMATCH", async () => {
      // El comprobante es de producción, pero su XML dice pruebas.
      const document = await authorizedDocument({ environment: "PRODUCTION" });
      const job = await jobFor(document);
      await handler().run(job, context());
      expect(await jobOf(job.id)).toMatchObject({
        status: "STOPPED",
        lastErrorCode: "RIDE_AUTHORIZATION_MISMATCH",
        lastErrorDetail: { items: "ambiente" },
      });
      expect(await stateOf(document.id)).toBe("AUTHORIZED");
    });

    it("un logo alterado se detiene con RIDE_LOGO_INTEGRITY", async () => {
      const logo = pngBytes(30, 30, 9);
      const asset = await prisma.configurationAsset.create({
        data: {
          companyId: company.companyId,
          kind: "LOGO",
          mimeType: "image/png",
          sizeBytes: logo.length,
          sha256: "0".repeat(64),
          content: new Uint8Array(logo),
          createdById: company.adminId,
        },
      });
      const version = await prisma.companyConfigVersion.create({
        data: {
          companyId: company.companyId,
          version: 2,
          ruc: "1790012345001",
          legalName: "COMERCIAL ANDINA S.A.",
          headOfficeAddress: "Av. Amazonas N24-03, Quito",
          accountingRequired: true,
          largeTaxpayer: false,
          environment: "TEST",
          logoAssetId: asset.id,
          createdById: company.adminId,
        },
      });
      const document = await authorizedDocument({ configVersionId: version.id });
      const job = await jobFor(document);
      await handler().run(job, context());
      expect(await jobOf(job.id)).toMatchObject({
        status: "STOPPED",
        lastErrorCode: "RIDE_LOGO_INTEGRITY",
      });
    });

    it("un carácter sin glifo se detiene con sus puntos de código", async () => {
      const document = await authorizedDocument(
        {},
        {
          ...INVOICE_CASES.oneLine,
          buyer: { ...INVOICE_CASES.complete.buyer, legalName: "EMPRESA 漢字" },
        },
      );
      const job = await jobFor(document);
      await handler().run(job, context());
      expect(await jobOf(job.id)).toMatchObject({
        status: "STOPPED",
        lastErrorCode: "RIDE_GLYPH_MISSING",
        lastErrorClass: "DETERMINISTIC",
        lastErrorDetail: { items: "U+6F22,U+5B57" },
      });
      expect(await stateOf(document.id)).toBe("AUTHORIZED");
    });

    it("un comprobante que no está autorizado se detiene sin dibujar", async () => {
      const document = await authorizedDocument({ state: "RECEIVED" });
      const job = await jobFor(document);
      await handler().run(job, context());
      expect(await jobOf(job.id)).toMatchObject({
        status: "STOPPED",
        lastErrorCode: "RIDE_DOCUMENT_NOT_AUTHORIZED",
      });
    });
  });

  describe("fallos operativos", () => {
    it("un pool ocupado reprograma sin gastar el intento", async () => {
      const document = await authorizedDocument();
      const job = await jobFor(document);
      await handler(failing("BUSY")).run(job, context());
      const row = await jobOf(job.id);
      expect(row).toMatchObject({ status: "PENDING", attemptCount: 0 });
      expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
      expect(await stateOf(document.id)).toBe("AUTHORIZED");
    });

    it("un plazo vencido reintenta con backoff y, al agotar los intentos, queda detenido", async () => {
      const document = await authorizedDocument();
      const job = await jobFor(document);
      await handler(failing("TIMEOUT")).run(job, context());
      expect(await jobOf(job.id)).toMatchObject({
        status: "PENDING",
        attemptCount: 1,
        lastErrorCode: "RIDE_RENDER_TIMEOUT",
        lastErrorClass: "RETRYABLE",
      });
      // Los intentos restantes, con el arriendo tomado como lo haría el runner.
      for (let attempt = 2; attempt <= SETTINGS.maxAttempts; attempt++) {
        const leased = (await prisma.job.update({
          where: { id: job.id },
          data: {
            status: "LEASED",
            leaseOwner: "worker-de-prueba",
            leaseExpiresAt: new Date(Date.now() + 60_000),
            attemptCount: { increment: 1 },
          },
        })) as unknown as Job;
        await handler(failing("WORKER")).run(leased, context());
      }
      expect(await jobOf(job.id)).toMatchObject({
        status: "STOPPED",
        lastErrorCode: "RIDE_RENDER_WORKER",
      });
      expect(await stateOf(document.id)).toBe("AUTHORIZED");
      expect(await rides(document.id)).toEqual([]);
    });
  });

  it("el job del RIDE es del tipo document.render_ride con su clave por comprobante", async () => {
    const document = await authorizedDocument();
    const job = await jobFor(document);
    expect(job).toMatchObject({
      type: RIDE_JOB_TYPE,
      dedupeKey: `document.render_ride:${document.id}`,
    });
  });
});

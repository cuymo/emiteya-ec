// Envío automático de los comprobantes autorizados (add-email-delivery, design D2 a D7; spec
// email-delivery, «Envío automático al autorizar», «Receptores de cada comprobante», «Destino de
// prueba en el ambiente de Pruebas», «Contenido del correo», «Estados del envío», «Reintentos de
// los fallos temporales» y «Envío apagado por configuración»), contra un servidor SMTP falso: el RIDE
// real encola el correo, que sale una vez con los dos adjuntos; los desactivados no conectan; los
// fallos temporales se reintentan y los definitivos se detienen; el estado fiscal no cambia; en
// Pruebas va al correo de prueba; y los seis tipos llegan a sus receptores.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { EMAIL_SEND_JOB_TYPE } from "../../src/modules/email/application/automatic.ts";
import { emailModule } from "../../src/modules/email/infrastructure/index.ts";
import { RIDE_BACKOFF } from "../../src/modules/fiscal/application/archive/ride-jobs.ts";
import { createRideHandler } from "../../src/modules/fiscal/application/archive/ride-handler.ts";
import { createDeliverableDocumentSource } from "../../src/modules/fiscal/infrastructure/archive/deliverable-documents.ts";
import { createRideUnitOfWork } from "../../src/modules/fiscal/infrastructure/archive/ride-unit-of-work.ts";
import { createArtifactStore } from "../../src/modules/fiscal/infrastructure/prisma-artifacts.ts";
import { createDocumentRepository } from "../../src/modules/fiscal/infrastructure/prisma-documents.ts";
import { createPartyEmailSource } from "../../src/modules/parties/infrastructure/party-email-source.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { createCreditCapacityRepository } from "../../src/modules/credit-notes/infrastructure/prisma-credit-capacity.ts";
import { createSmtpPasswordVault } from "../../src/modules/email/infrastructure/password-vault.ts";
import {
  defaultRideFontsDirectory,
  loadRideAssets,
} from "../../src/modules/sri-engine/infrastructure/ride/ride-assets.ts";
import { createInProcessRideRenderer } from "../../src/modules/sri-engine/infrastructure/ride/ride-renderer.ts";
import { createConfigurationLogoReader } from "../../src/modules/taxpayer/infrastructure/prisma-configuration-assets.ts";
import { createPrismaJobStore, type JobStore } from "../../src/platform/jobs/prisma-job-store.ts";
import { startSmtpServer, smtpError, type SmtpTestServer } from "../support/smtp-test-server.ts";
import { insertArchiveDocument, nextInvoice } from "./archive-harness.ts";
import {
  insertAuthorizedInvoice,
  insertCreditNote,
  tamperSnapshot,
} from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertDebitNote } from "./debit-notes-harness.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { insertPurchaseSettlement } from "./purchase-settlement-harness.ts";
import { insertGuideParty, insertShippingGuide } from "./shipping-guide-harness.ts";
import { insertDocument, sha256, type TestDocument } from "./transmission-harness.ts";
import { insertWithholding } from "./withholding-harness.ts";
import { TEST_CUSTODY } from "./email-harness.ts";

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const assets = loadRideAssets(defaultRideFontsDirectory());
if (!assets.ok) throw new Error("las fuentes del RIDE no están íntegras");
const PDF = Buffer.from("%PDF-1.3\n%RIDE de prueba\n%%EOF\n");

/** El asunto de un correo crudo, desplegado y con sus palabras codificadas (RFC 2047) legibles. */
function subjectOf(raw: string): string {
  const header = /^Subject: ([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)/m.exec(raw)?.[1] ?? "";
  return header
    .replace(/\r?\n[ \t]+/g, " ")
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?UTF-8\?([QB])\?([^?]*)\?=/gi, (_match, encoding: string, text: string) =>
      encoding.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("utf8")
        : Buffer.from(
            text
              .replace(/_/g, " ")
              .replace(/=([0-9A-F]{2})/gi, (_hex, code: string) =>
                String.fromCharCode(parseInt(code, 16)),
              ),
            "latin1",
          ).toString("utf8"),
    );
}

describe("envío automático de los comprobantes", () => {
  let db: MigratedSchema;
  let prisma: PrismaClient;
  let store: JobStore;
  let company: FiscalCompany;
  let server: SmtpTestServer;
  let mailFromCalls = 0;
  let mailFromFailures = 0;
  let rejectAddress: string | null = null;
  let authFails = false;

  const moduleFor = (policy: { deliveryEnabled: boolean } = { deliveryEnabled: true }) =>
    emailModule({
      prisma,
      authorizer: {} as never,
      custody: TEST_CUSTODY,
      policy: { ...policy, plaintextAllowed: true },
      smtp: { connectionTimeoutMs: 2_000, socketTimeoutMs: 5_000 },
      schema: db.name,
      delivery: {
        jobs: store,
        documents: createDeliverableDocumentSource(prisma),
        parties: createPartyEmailSource(prisma),
        job: { maxAttempts: 3, backoff: { baseMs: 1, capMs: 1, minMs: 1 }, deadlineMs: 86_400_000 },
        logger: silent,
      },
    });

  const configure = async (overrides: Record<string, unknown> = {}) => {
    const data = {
      host: "127.0.0.1",
      port: server.port,
      security: "NONE",
      username: null,
      fromName: "Ferretería Andina",
      fromAddress: "facturas@andina.ec",
      bccAddress: null,
      autoSend: true,
      testRecipient: "revision@andina.ec",
      updatedBy: company.adminId,
      ...overrides,
    };
    await prisma.emailSettings.upsert({
      where: { companyId: company.companyId },
      create: { companyId: company.companyId, ...data },
      update: data,
    });
  };

  /** Un tercero con sus correos, en la empresa de la prueba. */
  const partyWith = async (emails: string[]) => {
    const identification =
      `17${String(Date.now() % 1e8).padStart(8, "0")}${Math.floor(Math.random() * 9)}`.slice(0, 10);
    const partyId = await insertGuideParty(prisma, company, identification);
    await prisma.partyEmail.createMany({
      data: emails.map((address, index) => ({
        partyId,
        companyId: company.companyId,
        position: index + 1,
        address,
      })),
    });
    return partyId;
  };

  /** El XML autorizado y el RIDE de un comprobante insertado con su XML firmado. */
  const withFiles = async (document: TestDocument) => {
    const existing = new Set(
      (
        await prisma.documentArtifact.findMany({
          where: { documentId: document.id },
          select: { kind: true },
        })
      ).map((artifact) => artifact.kind),
    );
    for (const [kind, mediaType, content] of [
      [
        "AUTHORIZED_XML",
        "application/xml",
        Buffer.from(`<comprobante>${document.accessKey}</comprobante>`),
      ],
      ["RIDE_PDF", "application/pdf", PDF],
    ] as const) {
      if (existing.has(kind)) continue;
      await prisma.documentArtifact.create({
        data: {
          companyId: document.companyId,
          documentId: document.id,
          kind,
          mediaType,
          content: new Uint8Array(content),
          sizeBytes: content.length,
          sha256: sha256(content),
          metadata: {},
        },
      });
    }
    return document;
  };

  /** Fija en el snapshot el emisor y los receptores que lee el correo. */
  const snapshotWith = (document: TestDocument, fields: Record<string, unknown>) =>
    tamperSnapshot(prisma, db.name, document.id, (snapshot) => ({
      ...snapshot,
      issuer: { legalName: "Ferretería Andina", tradeName: null },
      ...fields,
    }));

  /** El seguidor del RIDE, en una transacción como la del RIDE guardado. */
  const follow = (
    module: ReturnType<typeof moduleFor>,
    document: TestDocument,
    environment: "TEST" | "PRODUCTION" = "PRODUCTION",
  ) =>
    prisma.$transaction((tx) =>
      module.rideFollowers[0]!(
        tx,
        { id: document.id, companyId: document.companyId, environment },
        new Date(),
      ),
    );

  /** Toma y ejecuta los trabajos de correo pendientes hasta que no quede ninguno a la vista. */
  const drain = async (module: ReturnType<typeof moduleFor>, rounds = 10) => {
    const handler = module.handlers[EMAIL_SEND_JOB_TYPE]!;
    for (let round = 0; round < rounds; round++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const jobs = await store.claim({
        owner: "prueba",
        types: [EMAIL_SEND_JOB_TYPE],
        limit: 10,
        leaseMs: 60_000,
        now: new Date(),
      });
      if (jobs.length === 0) return;
      for (const job of jobs) {
        await handler.run(job, { signal: new AbortController().signal, now: () => new Date() });
      }
    }
  };

  const deliveryOf = (documentId: string) =>
    prisma.emailDelivery.findFirstOrThrow({
      where: { documentId },
      include: { attempts: { orderBy: { number: "asc" } } },
    });
  const messagesTo = (address: string) => server.messages.filter((m) => m.to.includes(address));

  beforeAll(async () => {
    server = await startSmtpServer({
      disabledCommands: ["STARTTLS"],
      allowInsecureAuth: true,
      onAuth: (auth, _session, callback) =>
        authFails
          ? callback(smtpError("Credenciales inválidas", 535))
          : callback(null, { user: auth.username }),
      onMailFrom: (_address, _session, callback) => {
        mailFromCalls++;
        if (mailFromFailures > 0) {
          mailFromFailures--;
          return callback(smtpError("Intenta más tarde", 451));
        }
        callback();
      },
      onRcptTo: (address, _session, callback) =>
        callback(address.address === rejectAddress ? smtpError("Buzón inexistente", 550) : null),
    });
    db = await createMigratedSchema("email_delivery_flow");
    prisma = db.database.prisma;
    store = createPrismaJobStore(prisma, db.name);
    await loadInstalledFiscalCatalogs(prisma);
    company = await insertFiscalCompany(prisma, "Correo Flujo", 1);
    await configure();
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
    await server?.close();
  });

  it("el RIDE guardado encola un correo que sale una vez con el XML autorizado y el RIDE", async () => {
    const module = moduleFor();
    const document = await insertArchiveDocument(
      prisma,
      company,
      await nextInvoice(inject("p12FixturesDir")),
    );
    const rideHandler = (renderer = createInProcessRideRenderer(assets.fonts)) =>
      createRideHandler({
        db: prisma,
        documents: createDocumentRepository(prisma),
        artifacts: createArtifactStore(prisma),
        logos: createConfigurationLogoReader(prisma),
        renderer,
        uow: createRideUnitOfWork(prisma),
        jobs: store,
        settings: { maxAttempts: 5, backoff: RIDE_BACKOFF },
        followers: module.rideFollowers,
        logger: silent,
      });
    // Sin RIDE no hay correo: un render rechazado detiene el RIDE y no crea el envío.
    await store.enqueueIn(prisma, {
      companyId: company.companyId,
      type: "document.render_ride",
      dedupeKey: `document.render_ride:${document.id}`,
      documentId: document.id,
      runAt: new Date(),
      maxAttempts: 5,
    });
    const rejecting = {
      render: () =>
        Promise.resolve({
          status: "REJECTED" as const,
          code: "RIDE_SOURCE_INVALID" as const,
          detail: [],
        }),
    };
    const [rideJob] = await store.claim({
      owner: "prueba",
      types: ["document.render_ride"],
      limit: 1,
      leaseMs: 60_000,
      now: new Date(),
    });
    await rideHandler(rejecting).run(rideJob!, {
      signal: new AbortController().signal,
      now: () => new Date(),
    });
    expect(await prisma.emailDelivery.count({ where: { documentId: document.id } })).toBe(0);

    // El reintento manual del RIDE lo guarda y, en su transacción, nace el envío automático.
    await store.enqueueIn(prisma, {
      companyId: company.companyId,
      type: "document.render_ride",
      dedupeKey: `document.render_ride:${document.id}`,
      documentId: document.id,
      runAt: new Date(),
      maxAttempts: 5,
      origin: "MANUAL",
      requestedBy: company.adminId,
    });
    const [retry] = await store.claim({
      owner: "prueba",
      types: ["document.render_ride"],
      limit: 1,
      leaseMs: 60_000,
      now: new Date(),
    });
    await rideHandler().run(retry!, {
      signal: new AbortController().signal,
      now: () => new Date(),
    });
    expect((await deliveryOf(document.id)).status).toBe("PENDING");

    await drain(module);
    const delivery = await deliveryOf(document.id);
    // La factura de los fixtures está firmada en Pruebas: el correo va al correo de prueba.
    expect(delivery).toMatchObject({
      status: "SENT",
      origin: "AUTOMATIC",
      environment: "TEST",
      testRedirect: true,
      attemptCount: 1,
    });
    expect(delivery.recipients).toEqual([
      { address: "revision@andina.ec", outcome: "ACCEPTED", reason: null },
    ]);
    expect(delivery.attempts.map((a) => [a.number, a.outcome, a.smtpCode])).toEqual([
      [1, "SENT", 250],
    ]);
    const mail = messagesTo("revision@andina.ec").at(-1);
    expect(mail!.raw).toContain(`${document.accessKey}.xml`);
    expect(mail!.raw).toContain(`${document.accessKey}.pdf`);
    expect(mail!.raw).toContain(`Message-ID: <envio-${delivery.id}@andina.ec>`);
    // El estado fiscal no cambia por el correo.
    expect(
      (await prisma.electronicDocument.findUniqueOrThrow({ where: { id: document.id } })).state,
    ).toBe("AUTHORIZED");
  }, 60_000);

  it("el seguidor procesado dos veces deja un solo envío y un solo correo", async () => {
    const module = moduleFor();
    const buyer = await partyWith(["unico@cliente.ec"]);
    const document = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(document, { buyer: { partyId: buyer, consumerFinal: false } });
    await follow(module, document);
    await follow(module, document);
    await drain(module);
    expect(await prisma.emailDelivery.count({ where: { documentId: document.id } })).toBe(1);
    expect(messagesTo("unico@cliente.ec")).toHaveLength(1);
  });

  it("con el envío automático apagado o sin servidor, el envío nace desactivado sin conectar", async () => {
    const module = moduleFor();
    const buyer = await partyWith(["apagado@cliente.ec"]);
    await configure({ autoSend: false });
    const off = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(off, { buyer: { partyId: buyer, consumerFinal: false } });
    await follow(module, off);
    await configure({ autoSend: true });
    await drain(module);
    expect(await deliveryOf(off.id)).toMatchObject({
      status: "DISABLED",
      failureCode: "AUTO_SEND_OFF",
      attemptCount: 0,
    });
    expect(messagesTo("apagado@cliente.ec")).toEqual([]);
    expect(
      await prisma.job.count({ where: { documentId: off.id, type: EMAIL_SEND_JOB_TYPE } }),
    ).toBe(0);
  });

  it("con el despliegue apagado no conecta, y encenderlo después no envía los desactivados", async () => {
    const buyer = await partyWith(["despliegue@cliente.ec"]);
    const document = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(document, { buyer: { partyId: buyer, consumerFinal: false } });
    const before = mailFromCalls;
    await follow(moduleFor({ deliveryEnabled: false }), document);
    await drain(moduleFor({ deliveryEnabled: true }));
    expect(await deliveryOf(document.id)).toMatchObject({
      status: "DISABLED",
      failureCode: "DELIVERY_DISABLED",
    });
    expect(mailFromCalls).toBe(before);
  });

  it("un fallo temporal se reintenta y después queda enviado", async () => {
    const module = moduleFor();
    const buyer = await partyWith(["reintento@cliente.ec"]);
    const document = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(document, { buyer: { partyId: buyer, consumerFinal: false } });
    mailFromFailures = 1;
    await follow(module, document);
    await drain(module, 1);
    expect(await deliveryOf(document.id)).toMatchObject({
      status: "RETRYING",
      failureCode: "TEMPORARY_REJECTION",
    });
    await drain(module);
    const delivery = await deliveryOf(document.id);
    expect(delivery.status).toBe("SENT");
    expect(delivery.attempts.map((a) => [a.outcome, a.smtpCode])).toEqual([
      ["RETRYABLE", 451],
      ["SENT", 250],
    ]);
  });

  it("los reintentos agotados dejan el envío fallido con el último motivo", async () => {
    const module = moduleFor();
    const buyer = await partyWith(["agotado@cliente.ec"]);
    const document = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(document, { buyer: { partyId: buyer, consumerFinal: false } });
    mailFromFailures = 10;
    await follow(module, document);
    await drain(module);
    mailFromFailures = 0;
    const delivery = await deliveryOf(document.id);
    expect(delivery).toMatchObject({
      status: "FAILED",
      failureCode: "TEMPORARY_REJECTION",
      attemptCount: 3,
    });
    expect(delivery.finishedAt).not.toBeNull();
    expect(delivery.attempts.every((a) => a.outcome === "RETRYABLE")).toBe(true);
    expect(
      (await prisma.electronicDocument.findUniqueOrThrow({ where: { id: document.id } })).state,
    ).toBe("AUTHORIZED");
  });

  it("las credenciales rechazadas detienen el envío sin más intentos", async () => {
    const module = moduleFor();
    const buyer = await partyWith(["credenciales@cliente.ec"]);
    const document = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(document, { buyer: { partyId: buyer, consumerFinal: false } });
    const vault = createSmtpPasswordVault({
      activeVersion: TEST_CUSTODY.enabled ? TEST_CUSTODY.keyVersion : "1",
      keys: new Map([["1", TEST_CUSTODY.enabled ? TEST_CUSTODY.key : Buffer.alloc(32)]]),
    });
    const sealed = vault.seal("clave-rechazada", company.companyId);
    await configure({ username: "facturas@andina.ec" });
    await prisma.emailSettingsSecret.create({
      data: {
        companyId: company.companyId,
        formatVersion: sealed.formatVersion,
        keyVersion: sealed.keyVersion,
        keyCheck: new Uint8Array(sealed.keyCheck),
        wrappedKey: new Uint8Array(sealed.wrappedKey),
        wrappedKeyNonce: new Uint8Array(sealed.wrappedKeyNonce),
        passwordCiphertext: new Uint8Array(sealed.passwordCiphertext),
        passwordNonce: new Uint8Array(sealed.passwordNonce),
      },
    });
    authFails = true;
    await follow(module, document);
    await drain(module);
    authFails = false;
    await prisma.emailSettingsSecret.delete({ where: { companyId: company.companyId } });
    await configure({ username: null });
    const delivery = await deliveryOf(document.id);
    expect(delivery).toMatchObject({
      status: "FAILED",
      failureCode: "AUTH_REJECTED",
      attemptCount: 1,
    });
    expect(delivery.failureReason).toBe("El servidor rechazó el usuario o la contraseña.");
    expect(delivery.attempts.map((a) => [a.outcome, a.smtpCode])).toEqual([["DETERMINISTIC", 535]]);
    expect(JSON.stringify(delivery)).not.toContain("clave-rechazada");
  });

  it("una dirección rechazada no impide el envío a las demás", async () => {
    const module = moduleFor();
    const buyer = await partyWith(["bien@cliente.ec", "rechazada@cliente.ec"]);
    const document = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(document, { buyer: { partyId: buyer, consumerFinal: false } });
    rejectAddress = "rechazada@cliente.ec";
    await follow(module, document);
    await drain(module);
    rejectAddress = null;
    expect((await deliveryOf(document.id)).recipients).toEqual([
      { address: "bien@cliente.ec", outcome: "ACCEPTED", reason: null },
      {
        address: "rechazada@cliente.ec",
        outcome: "REJECTED",
        reason: "El servidor de correo rechazó esta dirección (550).",
      },
    ]);
  });

  it("sin correo del receptor, o el consumidor final, queda sin destinatario", async () => {
    const module = moduleFor();
    const quiet = await partyWith([]);
    const noEmail = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(noEmail, { buyer: { partyId: quiet, consumerFinal: false } });
    const consumer = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(consumer, { buyer: { partyId: randomUUID(), consumerFinal: true } });
    await follow(module, noEmail);
    await follow(module, consumer);
    await drain(module);
    expect(await deliveryOf(noEmail.id)).toMatchObject({
      status: "NO_RECIPIENT",
      failureCode: "NO_ADDRESS",
    });
    expect(await deliveryOf(consumer.id)).toMatchObject({
      status: "NO_RECIPIENT",
      failureCode: "CONSUMER_FINAL",
    });
  });

  it("en Pruebas va solo al correo de prueba, con la marca en el asunto", async () => {
    const module = moduleFor();
    const buyer = await partyWith(["nunca@cliente.ec"]);
    const document = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(document, { buyer: { partyId: buyer, consumerFinal: false } });
    await follow(module, document, "TEST");
    await drain(module);
    expect(await deliveryOf(document.id)).toMatchObject({
      status: "SENT",
      testRedirect: true,
      environment: "TEST",
    });
    expect(messagesTo("nunca@cliente.ec")).toEqual([]);
    const mail = messagesTo("revision@andina.ec").at(-1)!;
    expect(subjectOf(mail.raw)).toMatch(/^PRUEBAS – sin validez tributaria · Factura /);

    await configure({ testRecipient: null });
    const another = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(another, { buyer: { partyId: buyer, consumerFinal: false } });
    await follow(module, another, "TEST");
    await drain(module);
    await configure();
    expect(await deliveryOf(another.id)).toMatchObject({
      status: "NO_RECIPIENT",
      failureCode: "NO_TEST_RECIPIENT",
    });
  });

  it("un XML o un RIDE alterado impide el envío", async () => {
    const module = moduleFor();
    const buyer = await partyWith(["alterado@cliente.ec"]);
    const document = await withFiles(await insertDocument(prisma, company, "AUTHORIZED"));
    await snapshotWith(document, { buyer: { partyId: buyer, consumerFinal: false } });
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${db.name}"."document_artifact" DISABLE TRIGGER USER`,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "${db.name}"."document_artifact" SET sha256 = repeat('0', 64) WHERE document_id = $1 AND kind = 'RIDE_PDF'`,
      document.id,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "${db.name}"."document_artifact" ENABLE TRIGGER USER`,
    );
    await follow(module, document);
    await drain(module);
    expect(await deliveryOf(document.id)).toMatchObject({
      status: "FAILED",
      failureCode: "ARTIFACT_MISSING",
    });
    expect(messagesTo("alterado@cliente.ec")).toEqual([]);
  });

  it("los seis tipos llegan a sus receptores", async () => {
    const module = moduleFor();
    const buyer = await partyWith(["comprador@cliente.ec"]);
    const supplier = await partyWith(["proveedor@proveedor.ec"]);
    const recipient = await partyWith(["bodega@destino.ec"]);
    const carrier = await partyWith(["despacho@transporte.ec"]);

    const product = await insertProduct(prisma, company);
    const invoice = await insertAuthorizedInvoice(
      prisma,
      {
        companyId: company.companyId,
        adminId: company.adminId,
        establishmentId: company.points[0]!.establishmentId,
        emissionPointId: company.points[0]!.emissionPointId,
      },
      [{ productId: product, quantity: "4", unitPrice: "10.00" }],
    );
    await tamperSnapshot(prisma, db.name, invoice.id, (snapshot) => ({
      ...snapshot,
      buyer: { ...(snapshot.buyer as object), partyId: buyer, consumerFinal: false },
    }));
    const invoiceDoc = { ...invoice, companyId: company.companyId } as unknown as TestDocument;
    await withFiles(invoiceDoc);
    const credit = await withFiles(
      await insertCreditNote(prisma, company, invoice, { lines: [{ position: 1, quantity: "1" }] }),
    );
    // Su autorización, como la aplica el sistema: el comprobante autorizado y su reserva aplicada.
    await prisma.$transaction(async (tx) => {
      await tx.electronicDocument.update({
        where: { id: credit.id },
        data: {
          state: "AUTHORIZED",
          authorizationNumber: credit.accessKey,
          authorizationDate: new Date(),
          authorizationEnvironment: "TEST",
        },
      });
      await createCreditCapacityRepository(tx).conclude(
        company.companyId,
        credit.id,
        "APPLIED",
        new Date(),
      );
    });
    // El snapshot real de la nota guarda la factura que modifica; el helper no la escribe.
    await snapshotWith(credit, { invoice: { id: invoice.id } });
    const debit = await withFiles(await insertDebitNote(prisma, company, invoice.id, "AUTHORIZED"));
    await snapshotWith(debit, { invoice: { id: invoice.id } });
    const withholding = await withFiles(
      await insertWithholding(prisma, company, supplier, "AUTHORIZED"),
    );
    await snapshotWith(withholding, { subject: { partyId: supplier } });
    const settlement = await withFiles(
      await insertPurchaseSettlement(prisma, company, supplier, "AUTHORIZED"),
    );
    await snapshotWith(settlement, { supplier: { partyId: supplier } });
    const guide = await withFiles(await insertShippingGuide(prisma, company, "AUTHORIZED"));
    await snapshotWith(guide, {
      recipients: [
        { position: 1, kind: "PARTY", partyId: recipient },
        { position: 2, kind: "OWN_COMPANY", partyId: null },
      ],
      transporter: { source: "PARTY", partyId: carrier },
    });

    for (const document of [invoiceDoc, credit, debit, withholding, settlement, guide]) {
      await follow(module, document);
    }
    await drain(module);
    const addresses = async (document: TestDocument) =>
      ((await deliveryOf(document.id)).recipients as { address: string }[]).map((r) => r.address);
    expect(await addresses(invoiceDoc)).toEqual(["comprador@cliente.ec"]);
    expect(await addresses(credit)).toEqual(["comprador@cliente.ec"]);
    expect(await addresses(debit)).toEqual(["comprador@cliente.ec"]);
    expect(await addresses(withholding)).toEqual(["proveedor@proveedor.ec"]);
    expect(await addresses(settlement)).toEqual(["proveedor@proveedor.ec"]);
    expect(await addresses(guide)).toEqual(["bodega@destino.ec", "despacho@transporte.ec"]);
    const subjects = server.messages
      .filter((m) =>
        ["comprador@cliente.ec", "proveedor@proveedor.ec", "bodega@destino.ec"].some((a) =>
          m.to.includes(a),
        ),
      )
      .map((m) => subjectOf(m.raw));
    for (const name of [
      "Factura",
      "Nota de crédito",
      "Nota de débito",
      "Comprobante de retención",
      "Liquidación de compra",
      "Guía de remisión",
    ]) {
      expect(
        subjects.some((subject) => subject.includes(name)),
        name,
      ).toBe(true);
    }
  }, 60_000);
});

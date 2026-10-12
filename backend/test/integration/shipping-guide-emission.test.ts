// Emisión de guías de remisión por HTTP (add-shipping-guides, tarea 7.1, design D10 a D15, D24 y
// D27): una guía de un destinatario y otra de varios firmadas con su propio contador; la vista
// previa, el snapshot, el XML y la consulta con los mismos datos; cada rechazo de la evaluación sin
// reservar número; la declaración ausente, de otra versión o sin excepciones rechazada, y congelada
// por destinatario cuando se confirma; un tercero, un producto o un establecimiento que cambia
// después de reservar no cambia el XML firmado; el doble envío secuencial y simultáneo con una sola
// guía; la repetición que reanuda la firma; la clave reutilizada o ausente; la auditoría sin
// direcciones, placa, XML ni SOAP; y las métricas.
import { randomUUID } from "node:crypto";
import { Registry } from "@prometheus-io/client";
import request from "../support/http-client.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ShippingGuideDraftView, ShippingGuideView } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { shippingGuideFingerprint } from "../../src/modules/shipping-guides/application/emission.ts";
import type { ShippingGuideSnapshot } from "../../src/modules/shipping-guides/domain/snapshot.ts";
import { createShippingGuideDraftRepository } from "../../src/modules/shipping-guides/infrastructure/prisma-drafts.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { insertAuthorizedInvoice, type AuthorizedInvoiceDocument } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, createProduct, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertGuideParty } from "./shipping-guide-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body = {
  data: ShippingGuideView & ShippingGuideDraftView;
  error: { code: string; message: string };
};
const bodyOf = (res: { body: unknown }) => res.body as Body;
type App = ReturnType<typeof buildTaxpayerApp>;
const compact = (xml: string) => xml.replace(/>\s+</g, "><");
const count = (text: string, part: string) => text.split(part).length - 1;

const TODAY = new Date("2026-10-06T15:00:00Z");
// 10:00 del 6 de octubre de 2026 en Ecuador.
let clock = TODAY;
const COMPANY_RUC = "1790012345001";
const DECLARED = { policyVersion: 1 };

describe("emisión de guías de remisión", () => {
  let db: MigratedSchema;
  let api: App;
  let reserving: App;
  let a: ReadyCompany;
  let unsigned: ReadyCompany;
  let destinationId: string;
  let carrierId: string;
  let plainPartyId: string;
  let serviceProductId: string;
  let invoice: AuthorizedInvoiceDocument;
  let signedInvoice: AuthorizedInvoiceDocument;
  const registry = new Registry();
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const invoiceRecipient = (overrides: Record<string, unknown> = {}) => ({
    recipient: { kind: "PARTY", partyId: a.customerId },
    address: "Av. Simón Bolívar S/N",
    motive: "Venta",
    route: "Quito - Cayambe",
    support: { kind: "INTERNAL_INVOICE", invoiceId: invoice.id },
    details: [{ productId: a.productId, description: "Cemento 50 kg", quantity: "10" }],
    ...overrides,
  });
  const consignment = (partyId = plainPartyId) => ({
    recipient: { kind: "PARTY", partyId },
    address: "Calle Sucre 12",
    motive: "Consignación",
    support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
    details: [{ productId: null, description: "Varilla 12 mm", quantity: "2.500" }],
  });
  const ownTransfer = (destinationEstablishmentId = destinationId) => ({
    recipient: { kind: "OWN_COMPANY", destinationEstablishmentId },
    motive: "Reposición de bodega",
    support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
    details: [{ productId: null, mainCode: "VAR-12", description: "Varilla", quantity: "100" }],
  });
  const draft = async (overrides: Record<string, unknown> = {}, company = a) => {
    const res = await request(api.app)
      .post("/api/v1/shipping-guides/drafts")
      .set("Cookie", company.cookies.operator)
      .send({
        emissionPointId: company.emissionPointId,
        transporter: { source: "SELF" },
        plate: "PAA-1234",
        transportStart: "2026-10-06",
        transportEnd: "2026-10-07",
        recipients: [invoiceRecipient()],
        ...overrides,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return bodyOf(res).data;
  };
  const emit = (
    app: App,
    created: { id: string; version: number },
    options: { key?: string | null; declaration?: { policyVersion: number } | null } = {},
    company = a,
  ) => {
    const key = options.key === undefined ? randomUUID() : options.key;
    const req = request(app.app)
      .post("/api/v1/shipping-guides")
      .set("Cookie", company.cookies.operator);
    return (key === null ? req : req.set("Idempotency-Key", key)).send({
      draftId: created.id,
      expectedVersion: created.version,
      exceptionDeclaration: options.declaration ?? null,
    });
  };
  const trace = async () => {
    const prisma = db.database.prisma;
    return {
      documents: await prisma.electronicDocument.count({ where: { documentType: "06" } }),
      sequences: await prisma.fiscalSequenceReservation.count({ where: { documentType: "06" } }),
      guides: await prisma.shippingGuide.count(),
      recipients: await prisma.shippingGuideRecipient.count(),
      documentRecipients: await prisma.electronicDocumentRecipient.count(),
      audit: await prisma.auditEvent.count({
        where: { action: { startsWith: "shipping_guide." } },
      }),
      idempotency: await prisma.idempotencyRecord.count({
        where: { operation: "shipping_guide.emit" },
      }),
    };
  };
  const signedXml = async (documentId: string) =>
    compact(
      Buffer.from(
        (
          await db.database.prisma.documentArtifact.findFirstOrThrow({
            where: { documentId, kind: "SIGNED_XML" },
          })
        ).content,
      ).toString("utf8"),
    );
  const metric = async (name: string) => (await registry.getSingleMetricAsString(name)) ?? "";

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guide_emission");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const now = () => clock;
    api = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      shippingGuides: { metrics: registry },
      now,
    });
    reserving = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      shippingGuides: { signAfterReserve: false },
      now,
    });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "emision-guia", pool, p12Dir });
    unsigned = await readyCompany(api, db, { slug: "emision-guia-sin-firma" });
    const prisma = db.database.prisma;
    destinationId = (
      await prisma.establishment.create({
        data: { companyId: a.companyId, code: "002", address: "Bodega sur, Quito" },
      })
    ).id;
    const company = { companyId: a.companyId, adminId: a.adminId, points: [] };
    carrierId = await insertGuideParty(prisma, company, "1791111111001", {
      roles: ["CARRIER"],
      legalName: "TRANSPORTES ANDINOS S.A.",
    });
    plainPartyId = await insertGuideParty(prisma, company, "1793333333001", {
      legalName: "DESTINATARIO SIN ROL S.A.",
    });
    serviceProductId = await createProduct(db, a, { unitPrice: "20.00", name: "Instalación" });
    await prisma.product.update({ where: { id: serviceProductId }, data: { kind: "SERVICE" } });
    const invoiceCompany = {
      companyId: a.companyId,
      adminId: a.adminId,
      establishmentId: a.establishmentId,
      emissionPointId: a.emissionPointId,
    };
    invoice = await insertAuthorizedInvoice(prisma, invoiceCompany, [
      { productId: a.productId, quantity: "10", unitPrice: "8.75" },
    ]);
    signedInvoice = await insertAuthorizedInvoice(
      prisma,
      invoiceCompany,
      [{ productId: a.productId, quantity: "1", unitPrice: "8.75" }],
      { state: "SIGNED" },
    );
  }, 180_000);

  afterAll(async () => {
    await pool.close();
    await db?.drop();
  });

  it("una guía de un destinatario y otra de varios quedan firmadas con su propio contador", async () => {
    const partiesBefore = await db.database.prisma.party.count();
    const single = await emit(api, await draft());
    expect(single.status, JSON.stringify(single.body)).toBe(201);
    const guide = bodyOf(single).data;
    expect(guide).toMatchObject({
      documentType: "06",
      state: "SIGNED",
      documentNumber: "001-001-000000001",
      transporter: {
        source: "SELF",
        partyId: null,
        identificationType: "04",
        identification: COMPANY_RUC,
        legalName: "COMERCIAL ANDINA S.A.",
      },
      plate: "PAA-1234",
      counts: { recipients: 1, details: 1 },
    });
    expect(guide.accessKey.slice(8, 10)).toBe("06");
    expect(guide.recipients[0]!.support).toEqual({
      kind: "INTERNAL_INVOICE",
      invoice: {
        id: invoice.id,
        documentType: "01",
        documentNumber: invoice.documentNumber,
        issueDate: "2026-10-01",
        authorizationNumber: invoice.accessKey,
      },
    });

    const multiple = await emit(
      api,
      await draft({
        originEstablishmentId: a.establishmentId,
        recipients: [invoiceRecipient(), consignment(), ownTransfer()],
      }),
      { declaration: DECLARED },
    );
    expect(multiple.status, JSON.stringify(multiple.body)).toBe(201);
    const several = bodyOf(multiple).data;
    expect(several).toMatchObject({
      state: "SIGNED",
      documentNumber: "001-001-000000002",
      departure: {
        source: "ESTABLISHMENT",
        establishment: { id: a.establishmentId, code: "001" },
        address: "Av. 6 de Diciembre, Quito",
      },
      counts: { recipients: 3, details: 3 },
    });
    expect(several.recipients[2]).toMatchObject({
      kind: "OWN_COMPANY",
      destinationEstablishment: { id: destinationId, code: "002", address: "Bodega sur, Quito" },
      identification: COMPANY_RUC,
      legalName: "COMERCIAL ANDINA S.A.",
      address: "Bodega sur, Quito",
      destinationEstablishmentCode: "002",
    });
    // El contador del tipo 06 es propio: la factura sustento usó el suyo.
    const counters = await db.database.prisma.fiscalSequence.findMany({
      where: { companyId: a.companyId },
      select: { documentType: true, nextNumber: true },
    });
    expect(counters.find((c) => c.documentType === "06")?.nextNumber).toBe(3);
    expect(counters.find((c) => c.documentType === "01")?.nextNumber).toBe(3);

    const artifact = await db.database.prisma.documentArtifact.findFirstOrThrow({
      where: { documentId: several.id, kind: "SIGNED_XML" },
    });
    expect(artifact.metadata).toMatchObject({
      documentType: "06",
      schemaPath: "sri-xsd/GuiaRemision_V1.1.0.xsd",
    });
    const xml = await signedXml(several.id);
    expect(xml).toContain("<codDoc>06</codDoc>");
    expect(xml).toContain("<dirPartida>Av. 6 de Diciembre, Quito</dirPartida>");
    expect(count(xml, "<destinatario>")).toBe(3);
    expect(count(xml, "<numDocSustento>")).toBe(1);
    expect(xml).toContain("<codEstabDestino>002</codEstabDestino>");
    // La cabecera común no tiene total ni comprador; los destinatarios van en orden.
    const stored = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: several.id },
      include: { recipients: { orderBy: { position: "asc" } } },
    });
    expect([stored.total, stored.buyerIdentification, stored.buyerName]).toEqual([
      null,
      null,
      null,
    ]);
    expect(stored.recipients.map((r) => [r.position, r.identification])).toEqual([
      [1, "0992877878001"],
      [2, "1793333333001"],
      [3, COMPANY_RUC],
    ]);
    // Ni el transporte propio ni el traslado entre establecimientos propios crean un tercero.
    expect(await db.database.prisma.party.count()).toBe(partiesBefore);
  });

  it("una factura a consumidor final sustenta la guía de un destinatario identificado distinto del comprador", async () => {
    const consumerInvoice = await insertAuthorizedInvoice(
      db.database.prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.establishmentId,
        emissionPointId: a.emissionPointId,
      },
      [{ productId: a.productId, quantity: "2", unitPrice: "8.75" }],
      { consumerFinal: true },
    );
    const res = await emit(
      api,
      await draft({
        recipients: [
          invoiceRecipient({
            recipient: { kind: "PARTY", partyId: plainPartyId },
            support: { kind: "INTERNAL_INVOICE", invoiceId: consumerInvoice.id },
          }),
        ],
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [recipient] = bodyOf(res).data.recipients;
    expect(recipient).toMatchObject({
      identification: "1793333333001",
      legalName: "DESTINATARIO SIN ROL S.A.",
      support: { kind: "INTERNAL_INVOICE", invoice: { id: consumerInvoice.id } },
    });
    // El consumidor final nunca se copia como destinatario.
    expect(await signedXml(bodyOf(res).data.id)).not.toContain("9999999999999");
  });

  it("la vista previa, el snapshot, el XML y la consulta llevan los mismos datos", async () => {
    const created = await draft({
      transporter: { source: "PARTY", partyId: carrierId },
      recipients: [invoiceRecipient(), consignment()],
    });
    expect(created.preview.issues).toEqual([]);
    const res = await emit(api, created, { declaration: DECLARED });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const consulted = await request(api.app)
      .get(`/api/v1/shipping-guides/${bodyOf(res).data.id}`)
      .set("Cookie", a.cookies.operator);
    expect(consulted.status).toBe(200);
    const guide = bodyOf(consulted).data;
    expect(guide).toEqual(bodyOf(res).data);
    const { preview } = created;
    expect(guide.departure.address).toBe(preview.departureAddress);
    expect(guide.transporter).toMatchObject({ ...preview.carrier, partyId: carrierId });
    expect(
      guide.recipients.map((r) => ({
        identification: r.identification,
        legalName: r.legalName,
        address: r.address,
        destinationEstablishmentCode: r.destinationEstablishmentCode,
        details: r.details.map(({ position, mainCode, auxiliaryCode, description, quantity }) => ({
          position,
          mainCode,
          auxiliaryCode,
          description,
          quantity,
        })),
      })),
    ).toEqual(
      preview.recipients.map((r) => ({
        identification: r.identification,
        legalName: r.legalName,
        address: r.address,
        destinationEstablishmentCode: r.destinationEstablishmentCode,
        details: r.details,
      })),
    );
    const stored = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: guide.id },
    });
    const snapshot = stored.snapshot as unknown as ShippingGuideSnapshot;
    expect(snapshot).toMatchObject({
      departure: { source: "FREE_TEXT", establishment: null, address: preview.departureAddress },
      transporter: { source: "PARTY", partyId: carrierId, identification: "1791111111001" },
      plate: "PAA-1234",
      transportStart: "2026-10-06",
      transportEnd: "2026-10-07",
    });
    expect(snapshot.recipients[1]!.details[0]).toMatchObject({ quantity: "2.5" });
    const xml = await signedXml(guide.id);
    expect(xml).toContain(
      "<razonSocialTransportista>TRANSPORTES ANDINOS S.A.</razonSocialTransportista>",
    );
    expect(xml).toContain("<rucTransportista>1791111111001</rucTransportista>");
    expect(xml).toContain("<placa>PAA-1234</placa>");
    expect(xml).toContain(
      "<fechaIniTransporte>06/10/2026</fechaIniTransporte><fechaFinTransporte>07/10/2026</fechaFinTransporte>",
    );
    expect(xml).toContain("<ruta>Quito - Cayambe</ruta>");
    expect(xml).toContain(
      "<codigoInterno>CEM-50</codigoInterno><descripcion>Cemento 50 kg</descripcion><cantidad>10</cantidad>",
    );
    expect(xml).toContain("<descripcion>Varilla 12 mm</descripcion><cantidad>2.5</cantidad>");
    expect(
      await db.database.prisma.shippingGuide.findFirstOrThrow({ where: { documentId: guide.id } }),
    ).toMatchObject({
      transporterSource: "PARTY",
      carrierPartyId: carrierId,
      carrierIdentification: "1791111111001",
      carrierName: "TRANSPORTES ANDINOS S.A.",
      plate: "PAA-1234",
      recipientCount: 2,
      detailCount: 2,
    });
    expect(
      (
        await db.database.prisma.shippingGuideRecipient.findMany({
          where: { documentId: guide.id },
          orderBy: { position: "asc" },
        })
      ).map((r) => [r.position, r.recipientKind, r.supportKind, r.invoiceId, r.exceptionCase]),
    ).toEqual([
      [1, "PARTY", "INTERNAL_INVOICE", invoice.id, null],
      [2, "PARTY", "DECLARED_EXCEPTION", null, "CONSIGNMENT"],
    ]);
    expect(
      await db.database.prisma.shippingGuideDraft.findUniqueOrThrow({ where: { id: created.id } }),
    ).toMatchObject({ status: "EMITTED", documentId: guide.id });
  });

  it("rechaza cada problema de la evaluación sin reservar número ni auditar", async () => {
    const before = await trace();
    const rejected = async (
      overrides: Record<string, unknown>,
      code: string,
      options: { declaration?: { policyVersion: number } } = {},
      company = a,
    ) => {
      const res = await emit(api, await draft(overrides, company), options, company);
      expect([res.status, bodyOf(res).error.code], code).toEqual([409, code]);
      return bodyOf(res).error;
    };
    const early = await rejected(
      { transportStart: "2026-10-05" },
      "SHIPPING_GUIDE_START_BEFORE_ISSUE",
    );
    expect(early.message).toContain("error 82");
    // Un borrador válido el día que se preparó y emitido al día siguiente.
    const yesterday = await draft();
    expect(yesterday.preview.issues).toEqual([]);
    clock = new Date("2026-10-07T15:00:00Z");
    try {
      const late = await emit(api, yesterday);
      expect([late.status, bodyOf(late).error.code]).toEqual([
        409,
        "SHIPPING_GUIDE_START_BEFORE_ISSUE",
      ]);
    } finally {
      clock = TODAY;
    }
    await rejected(
      { transporter: { source: "PARTY", partyId: plainPartyId } },
      "SHIPPING_GUIDE_CARRIER_ROLE_REQUIRED",
    );
    await rejected(
      { recipients: [ownTransfer()] },
      "SHIPPING_GUIDE_ORIGIN_ESTABLISHMENT_REQUIRED",
      { declaration: DECLARED },
    );
    await rejected(
      { originEstablishmentId: destinationId, recipients: [ownTransfer(destinationId)] },
      "SHIPPING_GUIDE_SAME_ESTABLISHMENT",
      { declaration: DECLARED },
    );
    await rejected(
      {
        recipients: [
          invoiceRecipient({ support: { kind: "INTERNAL_INVOICE", invoiceId: signedInvoice.id } }),
        ],
      },
      "SHIPPING_GUIDE_INVOICE_NOT_AUTHORIZED",
    );
    await rejected(
      {
        recipients: [
          invoiceRecipient({
            details: [{ productId: serviceProductId, description: "Instalación", quantity: "1" }],
          }),
        ],
      },
      "SHIPPING_GUIDE_PRODUCT_NOT_GOOD",
    );
    await rejected(
      { recipients: [consignment(unsigned.customerId)] },
      "SIGNING_CERTIFICATE_NOT_USABLE",
      { declaration: DECLARED },
      unsigned,
    );
    // Un borrador guardado directamente con el consumidor final como destinatario.
    const consumer = await createShippingGuideDraftRepository(db.database.prisma).create(
      a.companyId,
      {
        emissionPointId: a.emissionPointId,
        originEstablishmentId: null,
        departureAddress: "Bodega norte",
        transporter: { source: "SELF" },
        plate: "PAA-1234",
        transportStart: "2026-10-06",
        transportEnd: "2026-10-06",
        recipients: [
          {
            recipient: { kind: "PARTY", partyId: a.consumerFinalId },
            address: "Sin dirección",
            motive: "Venta",
            route: null,
            destinationEstablishmentCode: null,
            support: { kind: "INTERNAL_INVOICE", invoiceId: invoice.id },
            details: [
              {
                productId: null,
                mainCode: null,
                auxiliaryCode: null,
                description: "Cemento",
                quantity: "1",
              },
            ],
          },
        ],
      },
      a.operatorId,
    );
    const consumerRes = await emit(api, consumer);
    expect([consumerRes.status, bodyOf(consumerRes).error.code]).toEqual([
      409,
      "SHIPPING_GUIDE_RECIPIENT_CONSUMER_FINAL",
    ]);
    const anonymous = await request(api.app)
      .post("/api/v1/shipping-guides")
      .set("Idempotency-Key", randomUUID())
      .send({ draftId: consumer.id, expectedVersion: 1, exceptionDeclaration: null });
    expect(anonymous.status).toBe(401);
    // Un problema dentro de un destinatario o de un detalle nombra su posición en el rechazo.
    const noMotive = await rejected(
      { recipients: [invoiceRecipient({ motive: null })] },
      "SHIPPING_GUIDE_MOTIVE_REQUIRED",
    );
    expect(noMotive.message).toMatch(/^Destinatario 1: /);
    const emptyDescription = await rejected(
      {
        recipients: [
          invoiceRecipient(),
          invoiceRecipient({ details: [{ productId: null, description: "", quantity: "1" }] }),
        ],
      },
      "SHIPPING_GUIDE_DESCRIPTION_INVALID",
    );
    expect(emptyDescription.message).toMatch(/^Destinatario 2, detalle 1: /);
    const zero = await rejected(
      {
        recipients: [
          invoiceRecipient({
            details: [
              { productId: a.productId, description: "Cemento 50 kg", quantity: "1" },
              { productId: null, description: "Varilla", quantity: "0" },
            ],
          }),
        ],
      },
      "SHIPPING_GUIDE_QUANTITY_INVALID",
    );
    expect(zero.message).toMatch(/^Destinatario 1, detalle 2: .*política del sistema/);
    // Un producto desactivado después de preparar el borrador.
    const retiring = await createProduct(db, a, { unitPrice: "3.00", name: "Arena fina" });
    const prepared = await draft({
      recipients: [
        invoiceRecipient({
          details: [{ productId: retiring, description: "Arena fina, 3 m3", quantity: "3" }],
        }),
      ],
    });
    expect(prepared.preview.issues).toEqual([]);
    await db.database.prisma.product.update({
      where: { id: retiring },
      data: { status: "INACTIVE" },
    });
    const inactive = await emit(api, prepared);
    expect([inactive.status, bodyOf(inactive).error.code]).toEqual([
      409,
      "SHIPPING_GUIDE_PRODUCT_INACTIVE",
    ]);
    expect(bodyOf(inactive).error.message).toMatch(/^Destinatario 1, detalle 1: /);
    // Ningún rechazo reservó número ni dejó registro, idempotencia o auditoría.
    expect(await trace()).toEqual(before);
  });

  it("la declaración es obligatoria con excepciones, de la versión vigente, y se congela por destinatario", async () => {
    const before = await trace();
    const declared = await draft({ recipients: [consignment(), invoiceRecipient()] });
    expect(declared.preview.exceptionDeclarationRequired).toBe(true);
    const missing = await emit(api, declared);
    expect([missing.status, bodyOf(missing).error.code]).toEqual([
      409,
      "SHIPPING_GUIDE_DECLARATION_REQUIRED",
    ]);
    const otherVersion = await emit(api, declared, { declaration: { policyVersion: 2 } });
    expect([otherVersion.status, bodyOf(otherVersion).error.code]).toEqual([
      409,
      "SHIPPING_GUIDE_DECLARATION_VERSION_MISMATCH",
    ]);
    const withoutExceptions = await emit(api, await draft(), { declaration: DECLARED });
    expect([withoutExceptions.status, bodyOf(withoutExceptions).error.code]).toEqual([
      409,
      "SHIPPING_GUIDE_DECLARATION_NOT_APPLICABLE",
    ]);
    expect(await trace()).toEqual(before);

    const key = randomUUID();
    const res = await emit(api, declared, { key, declaration: DECLARED });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const guide = bodyOf(res).data;
    expect(guide.recipients[0]!.support).toEqual({
      kind: "DECLARED_EXCEPTION",
      declaration: {
        case: "CONSIGNMENT",
        literal: "c",
        label: expect.any(String) as string,
        policyVersion: 1,
        basis: "USER_DECLARED",
        declaredBy: a.operatorId,
        declaredByName: "Operador emision-guia",
        declaredAt: TODAY.toISOString(),
      },
    });
    expect(guide.recipients[1]!.support.kind).toBe("INTERNAL_INVOICE");
    // La auditoría de la reserva lleva la consignación declarada con su versión y el actor.
    const reserved = (
      await db.database.prisma.auditEvent.findMany({
        where: { companyId: a.companyId, action: "shipping_guide.reserved" },
      })
    ).find((event) => (event.changes as { shippingGuideId?: string }).shippingGuideId === guide.id);
    expect([reserved?.actorUserId, reserved?.changes]).toEqual([
      a.operatorId,
      expect.objectContaining({ exceptions: ["1:CONSIGNMENT"], exceptionPolicyVersion: 1 }),
    ]);
    const rows = await db.database.prisma.shippingGuideRecipient.findMany({
      where: { documentId: guide.id },
      orderBy: { position: "asc" },
    });
    expect(
      rows.map((r) => [r.exceptionCase, r.exceptionPolicyVersion, r.declaredBy, r.declaredAt]),
    ).toEqual([
      ["CONSIGNMENT", 1, a.operatorId, TODAY],
      [null, null, null, null],
    ]);
    // El XML no lleva la declaración, el actor ni el momento.
    const xml = await signedXml(guide.id);
    expect(xml).not.toMatch(/CONSIGNMENT|USER_DECLARED|declar|Operador/i);
    // La misma clave con otra declaración es otra huella.
    const reused = await emit(api, declared, { key, declaration: null });
    expect([reused.status, bodyOf(reused).error.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    const record = await createShippingGuideDraftRepository(db.database.prisma).find(
      a.companyId,
      declared.id,
    );
    const input = { draftId: declared.id, expectedVersion: declared.version };
    expect(
      shippingGuideFingerprint({ ...input, exceptionDeclaration: DECLARED }, record!),
    ).not.toBe(shippingGuideFingerprint({ ...input, exceptionDeclaration: null }, record!));
    // Otra versión del borrador u otros destinatarios también son otra huella.
    const base = shippingGuideFingerprint({ ...input, exceptionDeclaration: DECLARED }, record!);
    expect(
      shippingGuideFingerprint(
        { ...input, expectedVersion: input.expectedVersion + 1, exceptionDeclaration: DECLARED },
        record!,
      ),
    ).not.toBe(base);
    expect(
      shippingGuideFingerprint(
        { ...input, exceptionDeclaration: DECLARED },
        { ...record!, recipients: [...record!.recipients].reverse() },
      ),
    ).not.toBe(base);
    const otherVersionKey = await emit(
      api,
      { id: declared.id, version: declared.version + 1 },
      { key, declaration: DECLARED },
    );
    expect([otherVersionKey.status, bodyOf(otherVersionKey).error.code]).toEqual([
      409,
      "IDEMPOTENCY_KEY_REUSED",
    ]);
  });

  it("el doble envío secuencial y simultáneo deja una sola guía; otra solicitud con la clave es un conflicto", async () => {
    const created = await draft();
    const key = randomUUID();
    const before = await trace();
    const [one, two] = await Promise.all([
      emit(api, created, { key }),
      emit(api, created, { key }),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 201]);
    expect(bodyOf(one).data.id).toBe(bodyOf(two).data.id);
    const again = await emit(api, created, { key });
    expect([again.status, bodyOf(again).data.id]).toEqual([200, bodyOf(one).data.id]);
    const after = await trace();
    expect([
      after.documents - before.documents,
      after.sequences - before.sequences,
      after.guides - before.guides,
      after.recipients - before.recipients,
      after.idempotency - before.idempotency,
    ]).toEqual([1, 1, 1, 1, 1]);

    const other = await draft({ plate: "PBB-5678" });
    const reused = await emit(api, other, { key });
    expect([reused.status, bodyOf(reused).error.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    expect(
      (await db.database.prisma.shippingGuideDraft.findUniqueOrThrow({ where: { id: other.id } }))
        .status,
    ).toBe("DRAFT");
    const twice = await emit(api, created);
    expect([twice.status, bodyOf(twice).error.code]).toEqual([
      409,
      "SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED",
    ]);
    const beforeRejections = await trace();
    const keyless = await emit(api, other, { key: null });
    expect([keyless.status, bodyOf(keyless).error.code]).toEqual([400, "IDEMPOTENCY_KEY_REQUIRED"]);
    const stale = await emit(api, { id: other.id, version: other.version + 1 });
    expect([stale.status, bodyOf(stale).error.code]).toEqual([409, "SHIPPING_GUIDE_DRAFT_CHANGED"]);
    expect(await trace()).toEqual(beforeRejections);
  });

  it("sin shippingGuides.emit responde 403, y un límite configurado se aplica también al emitir", async () => {
    const created = await draft({
      recipients: [
        invoiceRecipient({
          details: [
            { productId: a.productId, description: "Cemento 50 kg", quantity: "1" },
            { productId: null, description: "Arena", quantity: "2" },
          ],
        }),
      ],
    });
    const before = await trace();
    const denied = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      shippingGuides: { deny: ["shippingGuides.emit"] },
      now: () => clock,
    });
    const forbidden = await emit(denied, created);
    expect([forbidden.status, bodyOf(forbidden).error.code]).toEqual([403, "FORBIDDEN"]);
    const limited = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      shippingGuides: { limits: { details: 1 } },
      now: () => clock,
    });
    const overLimit = await emit(limited, created);
    expect([overLimit.status, bodyOf(overLimit).error.code]).toEqual([
      409,
      "SHIPPING_GUIDE_RESOURCE_LIMIT",
    ]);
    expect(bodyOf(overLimit).error.message).toContain(
      "Es una defensa de recursos del sistema, no un límite del SRI.",
    );
    expect(await trace()).toEqual(before);
  });

  it("la repetición de una guía que quedó reservada reanuda su firma sin otro número", async () => {
    const created = await draft();
    const key = randomUUID();
    const reserved = await emit(reserving, created, { key });
    expect([reserved.status, bodyOf(reserved).data.state]).toEqual([201, "RESERVED"]);
    const before = await trace();
    const resumed = await emit(api, created, { key });
    expect([resumed.status, bodyOf(resumed).data.state]).toEqual([200, "SIGNED"]);
    expect(bodyOf(resumed).data).toMatchObject({
      id: bodyOf(reserved).data.id,
      documentNumber: bodyOf(reserved).data.documentNumber,
      accessKey: bodyOf(reserved).data.accessKey,
    });
    const after = await trace();
    expect([after.documents, after.sequences, after.guides, after.idempotency]).toEqual([
      before.documents,
      before.sequences,
      before.guides,
      before.idempotency,
    ]);
  });

  it("audita la reserva y la firma con hechos seguros, sin direcciones, placa, XML ni SOAP, y cuenta las métricas", async () => {
    const res = await emit(
      api,
      await draft({
        originEstablishmentId: a.establishmentId,
        recipients: [invoiceRecipient(), ownTransfer()],
      }),
      { declaration: DECLARED },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const guide = bodyOf(res).data;
    const own = (
      await db.database.prisma.auditEvent.findMany({
        where: { companyId: a.companyId, action: { startsWith: "shipping_guide." } },
        orderBy: { occurredAt: "asc" },
      })
    ).filter(
      (event) => (event.changes as { shippingGuideId?: string }).shippingGuideId === guide.id,
    );
    expect(own.map((event) => [event.action, event.actorUserId])).toEqual([
      ["shipping_guide.reserved", a.operatorId],
      ["shipping_guide.signed", a.operatorId],
    ]);
    expect(own[0]!.changes).toEqual({
      shippingGuideId: guide.id,
      documentNumber: guide.documentNumber,
      accessKey: guide.accessKey,
      environment: "TEST",
      transporterSource: "SELF",
      carrierIdentification: COMPANY_RUC,
      carrierName: "COMERCIAL ANDINA S.A.",
      recipientCount: 2,
      detailCount: 2,
      supportKinds: ["DECLARED_EXCEPTION", "INTERNAL_INVOICE"],
      exceptions: ["2:OWN_ESTABLISHMENT_TRANSFER"],
      exceptionPolicyVersion: 1,
    });
    expect(JSON.stringify(own.map((event) => event.changes))).not.toMatch(
      /<\?xml|soap|PAA-1234|Av\.|Bodega|Cemento|Varilla/i,
    );
    expect(await metric("shipping_guide_reservations_total")).toMatch(
      /shipping_guide_reservations_total \d+/,
    );
    const recipients = await metric("shipping_guide_recipients_total");
    expect(recipients).toContain('support="internal_invoice"');
    expect(recipients).toContain('support="declared_exception"');
  });

  it("un tercero, un producto o un establecimiento que cambia después de reservar no cambia el XML firmado", async () => {
    const prisma = db.database.prisma;
    const created = await draft({
      originEstablishmentId: a.establishmentId,
      transporter: { source: "PARTY", partyId: carrierId },
      recipients: [invoiceRecipient(), ownTransfer()],
    });
    const reserved = await emit(reserving, created, { declaration: DECLARED });
    expect([reserved.status, bodyOf(reserved).data.state]).toEqual([201, "RESERVED"]);
    const restore = await Promise.all([
      prisma.party.findUniqueOrThrow({ where: { id: carrierId } }),
      prisma.party.findUniqueOrThrow({ where: { id: a.customerId } }),
      prisma.product.findUniqueOrThrow({ where: { id: a.productId } }),
      prisma.establishment.findUniqueOrThrow({ where: { id: a.establishmentId } }),
      prisma.establishment.findUniqueOrThrow({ where: { id: destinationId } }),
    ]);
    await prisma.party.update({
      where: { id: carrierId },
      data: { legalName: "OTRO TRANSPORTE S.A.", roles: [] },
    });
    await prisma.party.update({
      where: { id: a.customerId },
      data: { legalName: "OTRO NOMBRE S.A.", address: "Otra dirección" },
    });
    await prisma.product.update({ where: { id: a.productId }, data: { mainCode: "CEM-99" } });
    await prisma.establishment.update({
      where: { id: a.establishmentId },
      data: { address: "Origen corregido" },
    });
    await prisma.establishment.update({
      where: { id: destinationId },
      data: { address: "Destino corregido" },
    });
    try {
      const retried = await request(api.app)
        .post(`/api/v1/shipping-guides/${bodyOf(reserved).data.id}/signing-attempts`)
        .set("Cookie", a.cookies.operator);
      expect([retried.status, bodyOf(retried).data.state]).toEqual([200, "SIGNED"]);
      const xml = await signedXml(bodyOf(reserved).data.id);
      expect(xml).toContain(
        "<razonSocialTransportista>TRANSPORTES ANDINOS S.A.</razonSocialTransportista>",
      );
      expect(xml).toContain(
        "<razonSocialDestinatario>EL PERNO CIA. LTDA.</razonSocialDestinatario>",
      );
      expect(xml).toContain("<codigoInterno>CEM-50</codigoInterno>");
      expect(xml).toContain("<dirPartida>Av. 6 de Diciembre, Quito</dirPartida>");
      expect(xml).toContain("<dirDestinatario>Bodega sur, Quito</dirDestinatario>");
      expect(xml).not.toMatch(/OTRO|CEM-99|corregido/);
      // La misma fecha de emisión: la de la clave de acceso (la guía no lleva fechaEmision).
      expect(bodyOf(retried).data).toMatchObject({
        issueDate: "2026-10-06",
        accessKey: bodyOf(reserved).data.accessKey,
      });
      expect(xml).toContain(`<claveAcceso>${bodyOf(reserved).data.accessKey}</claveAcceso>`);
      expect(bodyOf(reserved).data.accessKey.slice(0, 8)).toBe("06102026");
    } finally {
      const [carrier, customer, product, origin, destination] = restore;
      await prisma.party.update({
        where: { id: carrierId },
        data: { legalName: carrier.legalName, roles: carrier.roles },
      });
      await prisma.party.update({
        where: { id: a.customerId },
        data: { legalName: customer.legalName, address: customer.address },
      });
      await prisma.product.update({
        where: { id: a.productId },
        data: { mainCode: product.mainCode },
      });
      await prisma.establishment.update({
        where: { id: a.establishmentId },
        data: { address: origin.address },
      });
      await prisma.establishment.update({
        where: { id: destinationId },
        data: { address: destination.address },
      });
    }
  });
});

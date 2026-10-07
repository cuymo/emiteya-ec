// API de búsquedas, opciones, borradores y vista previa de las guías de remisión (add-shipping-guides,
// tareas 6.1 y 6.2, design D3, D6 a D9, D12, D22 y D23): los transportistas con su elegibilidad y su
// motivo; los destinatarios sin el consumidor final ni el `08`; las facturas autorizadas del ambiente
// vigente, también a consumidor final; las mercancías sugeridas de una factura con sus datos
// históricos (`PRODUCT` o `FREE_LINE`, nunca "servicio"); las opciones; el borrador incompleto que se
// guarda sin reservar; la propuesta desde una factura; la partida propuesta y la derivada del origen;
// el traslado propio sin comparar con el establecimiento del punto; la versión; el borrador emitido
// inmutable; y `403`, `401` y otra empresa `404`.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  ShippingCarrierView,
  ShippingEligibleInvoiceView,
  ShippingGuideDraftSummaryView,
  ShippingGuideDraftView,
  ShippingGuideOptionsView,
  ShippingInvoiceGoodsView,
  ShippingRecipientPartyView,
} from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { certificateTasksEntry } from "../../src/modules/signing/infrastructure/index.ts";
import { createCryptoWorkerPool } from "../../src/platform/workers/crypto-worker-pool.ts";
import { insertAuthorizedInvoice, type AuthorizedInvoiceDocument } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { CUSTODY, createProduct, readyCompany, type ReadyCompany } from "./emission-harness.ts";
import { insertGuideParty, insertShippingGuide } from "./shipping-guide-harness.ts";
import { buildTaxpayerApp } from "./taxpayer-harness.ts";

type Body<T> = {
  data: T;
  meta?: { page: number; pageSize: number; total: number };
  error: { code: string; message: string };
};
const dataOf = <T>(res: { body: unknown }) => (res.body as Body<T>).data;
const errorOf = (res: { body: unknown }) => (res.body as Body<unknown>).error;
const codes = (draft: ShippingGuideDraftView) => draft.preview.issues.map((issue) => issue.code);

// 10:00 del 6 de octubre de 2026 en Ecuador.
const NOW = new Date("2026-10-06T15:00:00Z");
const COMPANY_RUC = "1790012345001";

describe("API de borradores de guía de remisión", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildTaxpayerApp>;
  let limited: ReturnType<typeof buildTaxpayerApp>;
  let limitedDetails: ReturnType<typeof buildTaxpayerApp>;
  let denied: ReturnType<typeof buildTaxpayerApp>;
  let a: ReadyCompany;
  let b: ReadyCompany;
  let secondEstablishmentId: string;
  let inactiveEstablishmentId: string;
  let carrierId: string;
  let longCarrierId: string;
  let plainPartyId: string;
  let invoice: AuthorizedInvoiceDocument;
  let consumerFinalInvoice: AuthorizedInvoiceDocument;
  let unresolvableInvoice: AuthorizedInvoiceDocument;
  let serviceProductId: string;
  let inactiveProductId: string;
  const pool = createCryptoWorkerPool({
    entry: certificateTasksEntry(),
    size: 2,
    timeoutMs: 30_000,
  });

  const call = (
    cookie: string,
    method: "get" | "post" | "put" | "delete",
    path: string,
    app = api,
  ) => request(app.app)[method](`/api/v1${path}`).set("Cookie", cookie);
  const recipientBody = (overrides: Record<string, unknown> = {}) => ({
    recipient: { kind: "PARTY", partyId: a.customerId },
    address: "Av. Simón Bolívar S/N",
    motive: "Venta",
    support: { kind: "INTERNAL_INVOICE", invoiceId: invoice.id },
    details: [{ productId: a.productId, description: "Cemento 50 kg", quantity: "10" }],
    ...overrides,
  });
  const draftBody = (overrides: Record<string, unknown> = {}) => ({
    emissionPointId: a.emissionPointId,
    transporter: { source: "SELF" },
    plate: "PAA-1234",
    transportStart: "2026-10-06",
    transportEnd: "2026-10-07",
    recipients: [recipientBody()],
    ...overrides,
  });
  const createDraft = async (body: Record<string, unknown> = draftBody()) => {
    const res = await call(a.cookies.operator, "post", "/shipping-guides/drafts").send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return dataOf<ShippingGuideDraftView>(res);
  };
  const fiscalTrace = async () => ({
    documents: await db.database.prisma.electronicDocument.count({ where: { documentType: "06" } }),
    reservations: await db.database.prisma.fiscalSequenceReservation.count({
      where: { documentType: "06" },
    }),
    guides: await db.database.prisma.shippingGuide.count(),
  });

  beforeAll(async () => {
    db = await createMigratedSchema("shipping_guide_drafts_api");
    await loadInstalledFiscalCatalogs(db.database.prisma);
    const now = () => NOW;
    api = buildTaxpayerApp(db, { signing: { pool, custody: CUSTODY }, now });
    limited = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now,
      shippingGuides: { limits: { recipients: 1, detailsPerRecipient: 2, details: 2 } },
    });
    // Un máximo de detalles por guía menor que destinatarios por detalles por destinatario.
    limitedDetails = buildTaxpayerApp(db, {
      signing: { pool, custody: CUSTODY },
      now,
      shippingGuides: { limits: { recipients: 5, detailsPerRecipient: 5, details: 3 } },
    });
    denied = buildTaxpayerApp(db, { now, shippingGuides: { deny: ["shippingGuides.draft"] } });
    const p12Dir = inject("p12FixturesDir");
    a = await readyCompany(api, db, { slug: "guia-a", pool, p12Dir });
    b = await readyCompany(api, db, { slug: "guia-b", pool, p12Dir });
    const prisma = db.database.prisma;
    secondEstablishmentId = (
      await prisma.establishment.create({
        data: { companyId: a.companyId, code: "002", address: "Bodega sur, Quito" },
      })
    ).id;
    inactiveEstablishmentId = (
      await prisma.establishment.create({
        data: {
          companyId: a.companyId,
          code: "003",
          address: "Local cerrado",
          active: false,
        },
      })
    ).id;
    const company = { companyId: a.companyId, adminId: a.adminId, points: [] };
    carrierId = await insertGuideParty(prisma, company, "1791111111001", {
      roles: ["CARRIER"],
      legalName: "TRANSPORTES ANDINOS S.A.",
    });
    longCarrierId = await insertGuideParty(prisma, company, "PAS12345678901", {
      roles: ["CARRIER"],
      identificationType: "06",
      legalName: "TRANSPORTISTA EXTRANJERO",
    });
    await insertGuideParty(prisma, company, "1792222222001", {
      roles: ["CARRIER"],
      legalName: "TRANSPORTES INACTIVOS S.A.",
    }).then((id) => prisma.party.update({ where: { id }, data: { status: "INACTIVE" } }));
    plainPartyId = await insertGuideParty(prisma, company, "1793333333001", {
      legalName: "DESTINATARIO SIN ROL S.A.",
    });
    await insertGuideParty(prisma, company, "EXT-0001", {
      identificationType: "08",
      legalName: "CLIENTE DEL EXTERIOR",
    });
    serviceProductId = await createProduct(db, a, {
      unitPrice: "20.00",
      name: "Instalación",
      mainCode: "SRV-1",
    });
    await prisma.product.update({ where: { id: serviceProductId }, data: { kind: "SERVICE" } });
    inactiveProductId = await createProduct(db, a, {
      unitPrice: "3.00",
      name: "Varilla",
      mainCode: "VAR-1",
    });
    await prisma.product.update({ where: { id: inactiveProductId }, data: { status: "INACTIVE" } });
    const invoiceCompany = {
      companyId: a.companyId,
      adminId: a.adminId,
      establishmentId: a.establishmentId,
      emissionPointId: a.emissionPointId,
    };
    invoice = await insertAuthorizedInvoice(prisma, invoiceCompany, [
      { productId: a.productId, quantity: "10", unitPrice: "8.75", description: "Cemento 50 kg" },
      {
        productId: serviceProductId,
        quantity: "1",
        unitPrice: "20.00",
        description: "Instalación en obra",
        mainCode: "SRV-1",
      },
      {
        productId: inactiveProductId,
        quantity: "2.500000",
        unitPrice: "3.00",
        description: "Varilla 12 mm",
        mainCode: "VAR-1",
      },
    ]);
    consumerFinalInvoice = await insertAuthorizedInvoice(
      prisma,
      invoiceCompany,
      [{ productId: a.productId, quantity: "1", unitPrice: "8.75" }],
      { consumerFinal: true },
    );
    unresolvableInvoice = await insertAuthorizedInvoice(prisma, invoiceCompany, [
      { productId: serviceProductId, quantity: "1", unitPrice: "20.00", description: "Servicio" },
    ]);
    await insertAuthorizedInvoice(
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

  describe("búsquedas y opciones", () => {
    it("transportistas: solo activos con el rol, y uno con más de 13 caracteres no seleccionable con su motivo", async () => {
      const res = await call(a.cookies.operator, "get", "/shipping-guides/carriers");
      expect(res.status).toBe(200);
      const carriers = dataOf<ShippingCarrierView[]>(res);
      expect(carriers.map((carrier) => carrier.legalName)).toEqual([
        "TRANSPORTES ANDINOS S.A.",
        "TRANSPORTISTA EXTRANJERO",
      ]);
      expect(carriers[0]).toMatchObject({ id: carrierId, selectable: true, reason: null });
      expect(carriers[1]).toMatchObject({ id: longCarrierId, selectable: false });
      expect(carriers[1]!.reason).toContain("como máximo 13");
      const searched = await call(
        a.cookies.operator,
        "get",
        "/shipping-guides/carriers?search=1791",
      );
      expect(dataOf<ShippingCarrierView[]>(searched).map((carrier) => carrier.id)).toEqual([
        carrierId,
      ]);
      expect((searched.body as Body<unknown>).meta).toEqual({ page: 1, pageSize: 25, total: 1 });
    });

    it("destinatarios: cualquier rol, sin el consumidor final ni el 08", async () => {
      const res = await call(a.cookies.operator, "get", "/shipping-guides/recipients?pageSize=50");
      expect(res.status).toBe(200);
      const names = dataOf<ShippingRecipientPartyView[]>(res).map((party) => party.legalName);
      expect(names).toEqual(
        expect.arrayContaining([
          "DESTINATARIO SIN ROL S.A.",
          "EL PERNO CIA. LTDA.",
          "PROVEEDORA DEL SUR S.A.",
          "TRANSPORTES ANDINOS S.A.",
        ]),
      );
      expect(names).not.toContain("CONSUMIDOR FINAL");
      expect(names).not.toContain("CLIENTE DEL EXTERIOR");
      expect(names).not.toContain("TRANSPORTES INACTIVOS S.A.");
    });

    it("facturas elegibles: autorizadas del ambiente vigente, también a consumidor final, con búsqueda", async () => {
      const res = await call(a.cookies.operator, "get", "/shipping-guides/eligible-invoices");
      expect(res.status).toBe(200);
      const invoices = dataOf<ShippingEligibleInvoiceView[]>(res);
      expect(invoices.map((item) => item.id).sort()).toEqual(
        [invoice.id, consumerFinalInvoice.id, unresolvableInvoice.id].sort(),
      );
      expect(invoices.find((item) => item.id === invoice.id)).toEqual({
        id: invoice.id,
        documentNumber: invoice.documentNumber,
        issueDate: "2026-10-01",
        buyerIdentification: "0992877878001",
        buyerName: "EL PERNO CIA. LTDA.",
        total: invoice.total,
      });
      const searched = await call(
        a.cookies.operator,
        "get",
        `/shipping-guides/eligible-invoices?search=${invoice.documentNumber}`,
      );
      expect(dataOf<ShippingEligibleInvoiceView[]>(searched).map((item) => item.id)).toEqual([
        invoice.id,
      ]);
      const other = await call(b.cookies.operator, "get", "/shipping-guides/eligible-invoices");
      expect(dataOf<ShippingEligibleInvoiceView[]>(other)).toEqual([]);
    });

    it("mercancías sugeridas: todas las líneas con sus datos históricos, PRODUCT o FREE_LINE, sin rotular servicios", async () => {
      const res = await call(
        a.cookies.operator,
        "get",
        `/shipping-guides/eligible-invoices/${invoice.id}/goods`,
      );
      expect(res.status).toBe(200);
      expect(dataOf<ShippingInvoiceGoodsView>(res)).toEqual({
        invoiceId: invoice.id,
        documentNumber: invoice.documentNumber,
        lines: [
          {
            position: 1,
            suggestion: "PRODUCT",
            productId: a.productId,
            mainCode: "COD-1",
            auxiliaryCode: null,
            description: "Cemento 50 kg",
            quantity: "10",
          },
          {
            position: 2,
            suggestion: "FREE_LINE",
            productId: null,
            mainCode: "SRV-1",
            auxiliaryCode: null,
            description: "Instalación en obra",
            quantity: "1",
          },
          {
            position: 3,
            suggestion: "FREE_LINE",
            productId: null,
            mainCode: "VAR-1",
            auxiliaryCode: null,
            description: "Varilla 12 mm",
            quantity: "2.500000",
          },
        ],
      });
      expect(JSON.stringify(res.body)).not.toMatch(/SERVICE|servicio|no trasladable/i);
      // Una factura sin líneas resolubles sigue elegible: sus líneas se ofrecen como líneas libres.
      const unresolvable = await call(
        a.cookies.operator,
        "get",
        `/shipping-guides/eligible-invoices/${unresolvableInvoice.id}/goods`,
      );
      expect(
        dataOf<ShippingInvoiceGoodsView>(unresolvable).lines.map((line) => line.suggestion),
      ).toEqual(["FREE_LINE"]);
      const other = await call(
        b.cookies.operator,
        "get",
        `/shipping-guides/eligible-invoices/${invoice.id}/goods`,
      );
      expect(other.status).toBe(404);
      expect(errorOf(other).code).toBe("SHIPPING_GUIDE_INVOICE_NOT_FOUND");
    });

    it("opciones: la política de excepciones con su versión, los establecimientos activos, la identidad y los límites", async () => {
      const res = await call(a.cookies.operator, "get", "/shipping-guides/options");
      expect(res.status).toBe(200);
      const options = dataOf<ShippingGuideOptionsView>(res);
      expect(options).toMatchObject({
        evaluatedOn: "2026-10-06",
        limits: { recipients: 10, detailsPerRecipient: 50, details: 100 },
        exceptionPolicy: { version: 1 },
        issuerIdentity: { ruc: COMPANY_RUC, legalName: "COMERCIAL ANDINA S.A." },
      });
      expect(options.exceptionPolicy.cases.map((item) => [item.literal, item.case])).toEqual([
        ["b", "QUANTITY_OR_PRICE_AFTER_TRANSFER"],
        ["c", "CONSIGNMENT"],
        ["d", "OWN_ESTABLISHMENT_TRANSFER"],
        ["e", "EXHIBITION_OR_DEMONSTRATION"],
      ]);
      expect(options.establishments.map((establishment) => establishment.code).sort()).toEqual([
        "001",
        "002",
      ]);
      const limitedOptions = await call(
        a.cookies.operator,
        "get",
        "/shipping-guides/options",
        limited,
      );
      expect(dataOf<ShippingGuideOptionsView>(limitedOptions).limits).toEqual({
        recipients: 1,
        detailsPerRecipient: 2,
        details: 2,
      });
    });
  });

  describe("borrador y vista previa", () => {
    it("un borrador vacío se guarda sin reservar nada, con sus problemas", async () => {
      const draft = await createDraft({});
      expect(draft).toMatchObject({
        version: 1,
        emissionPoint: null,
        originEstablishment: null,
        departureAddress: null,
        transporter: null,
        recipients: [],
      });
      expect(codes(draft)).toEqual(
        expect.arrayContaining([
          "SHIPPING_GUIDE_DRAFT_INCOMPLETE",
          "SHIPPING_GUIDE_CARRIER_REQUIRED",
          "SHIPPING_GUIDE_RECIPIENTS_REQUIRED",
        ]),
      );
      expect(await fiscalTrace()).toEqual({ documents: 0, reservations: 0, guides: 0 });
    });

    it("un borrador completo con transporte propio propone la partida del punto y no tiene problemas", async () => {
      const draft = await createDraft();
      expect(draft).toMatchObject({
        emissionPoint: {
          id: a.emissionPointId,
          establishmentCode: "001",
          code: "001",
          available: true,
        },
        originEstablishment: null,
        departureAddress: "Av. 6 de Diciembre, Quito",
        transporter: { source: "SELF" },
        recipients: [
          {
            recipient: {
              kind: "PARTY",
              partyId: a.customerId,
              party: { legalName: "EL PERNO CIA. LTDA." },
            },
            support: {
              kind: "INTERNAL_INVOICE",
              invoiceId: invoice.id,
              documentNumber: invoice.documentNumber,
            },
            details: [{ productId: a.productId, productName: "Cemento 50 kg", quantity: "10" }],
          },
        ],
      });
      expect(draft.preview).toMatchObject({
        evaluatedOn: "2026-10-06",
        departureAddress: "Av. 6 de Diciembre, Quito",
        carrier: { source: "SELF", identificationType: "04", identification: COMPANY_RUC },
        counts: { recipients: 1, details: 1 },
        exceptionDeclarationRequired: false,
        issues: [],
      });
      expect(draft.preview.recipients[0]).toMatchObject({
        identification: "0992877878001",
        support: {
          kind: "INTERNAL_INVOICE",
          invoice: { id: invoice.id, documentNumber: invoice.documentNumber },
        },
        details: [{ mainCode: "CEM-50", description: "Cemento 50 kg", quantity: "10" }],
      });
      expect(await fiscalTrace()).toEqual({ documents: 0, reservations: 0, guides: 0 });
    });

    it("informa los problemas junto a su destinatario y su detalle", async () => {
      const draft = await createDraft(
        draftBody({
          transporter: { source: "PARTY", partyId: plainPartyId },
          recipients: [
            recipientBody(),
            recipientBody({
              details: [{ productId: serviceProductId, description: "Instalación", quantity: "1" }],
            }),
          ],
        }),
      );
      const issues = draft.preview.issues.map(({ code, recipient, detail }) => ({
        code,
        recipient,
        detail,
      }));
      expect(issues).toEqual(
        expect.arrayContaining([
          { code: "SHIPPING_GUIDE_CARRIER_ROLE_REQUIRED", recipient: null, detail: null },
          { code: "SHIPPING_GUIDE_PRODUCT_NOT_GOOD", recipient: 2, detail: 1 },
        ]),
      );
      // La guía nunca asigna el rol de transportista.
      const party = await db.database.prisma.party.findUniqueOrThrow({
        where: { id: plainPartyId },
      });
      expect(party.roles).toEqual([]);
    });

    it("desde una factura propone su comprador, la factura como sustento y solo las sugerencias PRODUCT", async () => {
      const draft = await createDraft({ fromInvoiceId: invoice.id });
      expect(draft.recipients).toEqual([
        {
          recipient: {
            kind: "PARTY",
            partyId: a.customerId,
            party: {
              id: a.customerId,
              identificationType: "04",
              identification: "0992877878001",
              legalName: "EL PERNO CIA. LTDA.",
              address: "Av. Quito y Guayaquil",
            },
          },
          address: "Av. Quito y Guayaquil",
          motive: null,
          route: null,
          destinationEstablishmentCode: null,
          support: {
            kind: "INTERNAL_INVOICE",
            invoiceId: invoice.id,
            documentNumber: invoice.documentNumber,
          },
          details: [
            {
              productId: a.productId,
              productName: "Cemento 50 kg",
              mainCode: null,
              auxiliaryCode: null,
              description: "Cemento 50 kg",
              quantity: "10",
            },
          ],
        },
      ]);
      // A consumidor final: la factura sustenta, el destinatario identificado lo elige el usuario.
      const fromConsumerFinal = await createDraft({ fromInvoiceId: consumerFinalInvoice.id });
      expect(fromConsumerFinal.recipients[0]).toMatchObject({
        recipient: null,
        support: { kind: "INTERNAL_INVOICE", invoiceId: consumerFinalInvoice.id },
      });
      const accepted = await createDraft(
        draftBody({
          recipients: [
            recipientBody({
              recipient: { kind: "PARTY", partyId: plainPartyId },
              support: { kind: "INTERNAL_INVOICE", invoiceId: consumerFinalInvoice.id },
            }),
          ],
        }),
      );
      expect(accepted.preview.issues).toEqual([]);
      const missing = await call(a.cookies.operator, "post", "/shipping-guides/drafts").send({
        fromInvoiceId: invoice.id.replace(/.$/, "x"),
      });
      expect(missing.status).toBe(404);
    });

    it("traslado propio: el origen no tiene valor por defecto, la partida sale del origen y no se compara con el punto", async () => {
      const ownRecipient = (destinationEstablishmentId: string) => ({
        recipient: { kind: "OWN_COMPANY", destinationEstablishmentId },
        motive: "Reposición de bodega",
        support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
        details: [{ productId: null, description: "Varilla 12 mm", quantity: "100" }],
      });
      // Sin origen: la excepción d lo exige; el borrador no lo elige por su cuenta.
      const withoutOrigin = await createDraft(
        draftBody({ recipients: [ownRecipient(secondEstablishmentId)] }),
      );
      expect(withoutOrigin.originEstablishment).toBeNull();
      expect(codes(withoutOrigin)).toContain("SHIPPING_GUIDE_ORIGIN_ESTABLISHMENT_REQUIRED");
      // El origen es el 002 y el destino el 001, el del punto: se acepta.
      const draft = await createDraft(
        draftBody({
          originEstablishmentId: secondEstablishmentId,
          recipients: [ownRecipient(a.establishmentId)],
        }),
      );
      expect(draft).toMatchObject({
        originEstablishment: { id: secondEstablishmentId, code: "002" },
        departureAddress: null,
        recipients: [
          {
            recipient: {
              kind: "OWN_COMPANY",
              destinationEstablishmentId: a.establishmentId,
              establishment: { code: "001" },
            },
            support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
          },
        ],
      });
      expect(draft.preview).toMatchObject({
        departureAddress: "Bodega sur, Quito",
        exceptionDeclarationRequired: true,
        issues: [],
      });
      expect(draft.preview.recipients[0]).toMatchObject({
        identification: COMPANY_RUC,
        legalName: "COMERCIAL ANDINA S.A.",
        address: "Av. 6 de Diciembre, Quito",
        destinationEstablishmentCode: "001",
        support: { kind: "DECLARED_EXCEPTION", case: "OWN_ESTABLISHMENT_TRANSFER" },
      });
      // El mismo establecimiento como origen y destino, o uno desactivado, son problemas.
      const same = await createDraft(
        draftBody({
          originEstablishmentId: secondEstablishmentId,
          recipients: [ownRecipient(secondEstablishmentId)],
        }),
      );
      expect(codes(same)).toContain("SHIPPING_GUIDE_SAME_ESTABLISHMENT");
      const inactive = await createDraft(
        draftBody({
          originEstablishmentId: secondEstablishmentId,
          recipients: [ownRecipient(inactiveEstablishmentId)],
        }),
      );
      expect(codes(inactive)).toContain("SHIPPING_GUIDE_ESTABLISHMENT_INACTIVE");
    });

    it("la fecha de inicio anterior a la emisión es un problema con el texto del error 82", async () => {
      const draft = await createDraft(draftBody({ transportStart: "2026-10-05" }));
      const issue = draft.preview.issues.find(
        (item) => item.code === "SHIPPING_GUIDE_START_BEFORE_ISSUE",
      );
      expect(issue?.field).toBe("transportStart");
    });

    it("guarda un destinatario sin motivo, una descripción vacía y una cantidad cero, y la vista previa los informa con su posición", async () => {
      const draft = await createDraft(
        draftBody({
          recipients: [
            recipientBody({
              motive: null,
              details: [
                { productId: a.productId, description: "Cemento 50 kg", quantity: "0" },
                { productId: null, description: "", quantity: "1" },
              ],
            }),
          ],
        }),
      );
      const issues = draft.preview.issues.map(({ code, recipient, detail }) => ({
        code,
        recipient,
        detail,
      }));
      expect(issues).toEqual(
        expect.arrayContaining([
          { code: "SHIPPING_GUIDE_MOTIVE_REQUIRED", recipient: 1, detail: null },
          { code: "SHIPPING_GUIDE_QUANTITY_INVALID", recipient: 1, detail: 1 },
          { code: "SHIPPING_GUIDE_DESCRIPTION_INVALID", recipient: 1, detail: 2 },
        ]),
      );
      expect(
        draft.preview.issues.find((issue) => issue.code === "SHIPPING_GUIDE_QUANTITY_INVALID")
          ?.message,
      ).toContain("política del sistema");
    });

    it("un texto o un código fuera del contrato se rechaza al guardar nombrando su destinatario y su detalle", async () => {
      const longDescription = await call(
        a.cookies.operator,
        "post",
        "/shipping-guides/drafts",
      ).send(
        draftBody({
          recipients: [
            recipientBody(),
            recipientBody({
              details: [{ productId: null, description: "D".repeat(301), quantity: "1" }],
            }),
          ],
        }),
      );
      expect(longDescription.status).toBe(400);
      expect(errorOf(longDescription)).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Destinatario 2, detalle 1: La descripción admite como máximo 300 caracteres.",
      });
      const badCode = await call(a.cookies.operator, "post", "/shipping-guides/drafts").send(
        draftBody({ recipients: [recipientBody({ destinationEstablishmentCode: "1A" })] }),
      );
      expect(badCode.status).toBe(400);
      expect(errorOf(badCode)).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Destinatario 1: El código del establecimiento de destino tiene 3 dígitos.",
      });
      // Los espacios de los extremos no cuentan: una placa de 20 caracteres rodeada de espacios se
      // guarda recortada.
      const spaced = await createDraft(draftBody({ plate: `  ${"P".repeat(20)}  ` }));
      expect(spaced.plate).toBe("P".repeat(20));
    });

    it("el máximo de detalles por guía configurado rige aunque los otros dos permitan más", async () => {
      const twoByTwo = [recipientBody(), recipientBody()].map((recipient) => ({
        ...recipient,
        details: [
          { productId: a.productId, description: "Cemento 50 kg", quantity: "1" },
          { productId: null, description: "Varilla", quantity: "1" },
        ],
      }));
      const res = await call(
        a.cookies.operator,
        "post",
        "/shipping-guides/drafts",
        limitedDetails,
      ).send(draftBody({ recipients: twoByTwo }));
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: "SHIPPING_GUIDE_RESOURCE_LIMIT",
        message:
          "El sistema admite como máximo 3 detalles por guía. Es una defensa de recursos del sistema, no un límite del SRI.",
      });
    });

    it("los límites configurados rechazan el borrador como defensa de recursos", async () => {
      const res = await call(a.cookies.operator, "post", "/shipping-guides/drafts", limited).send(
        draftBody({ recipients: [recipientBody(), recipientBody()] }),
      );
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: "SHIPPING_GUIDE_RESOURCE_LIMIT",
        message:
          "El sistema admite como máximo 1 destinatarios por guía. Es una defensa de recursos del sistema, no un límite del SRI.",
      });
    });
  });

  describe("versión, lista, eliminación e inmutabilidad", () => {
    it("corrige con la versión consultada; otra versión es un conflicto", async () => {
      const draft = await createDraft();
      const res = await call(a.cookies.operator, "put", `/shipping-guides/drafts/${draft.id}`).send(
        { ...draftBody({ plate: "PBB-5678" }), expectedVersion: 1 },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(dataOf<ShippingGuideDraftView>(res)).toMatchObject({ version: 2, plate: "PBB-5678" });
      const stale = await call(
        a.cookies.operator,
        "put",
        `/shipping-guides/drafts/${draft.id}`,
      ).send({ ...draftBody(), expectedVersion: 1 });
      expect(stale.status).toBe(409);
      expect(errorOf(stale).code).toBe("SHIPPING_GUIDE_DRAFT_CHANGED");
    });

    it("lista los borradores con su transportista y sus cantidades, y elimina sin rastro", async () => {
      const draft = await createDraft(
        draftBody({ transporter: { source: "PARTY", partyId: carrierId } }),
      );
      const list = await call(a.cookies.operator, "get", "/shipping-guides/drafts?pageSize=100");
      expect(list.status).toBe(200);
      const summary = dataOf<ShippingGuideDraftSummaryView[]>(list).find(
        (item) => item.id === draft.id,
      );
      expect(summary).toMatchObject({
        version: 1,
        carrierName: "TRANSPORTES ANDINOS S.A.",
        recipientCount: 1,
        detailCount: 1,
        transportStart: "2026-10-06",
      });
      const removed = await call(
        a.cookies.operator,
        "delete",
        `/shipping-guides/drafts/${draft.id}`,
      );
      expect(removed.status).toBe(204);
      const gone = await call(a.cookies.operator, "get", `/shipping-guides/drafts/${draft.id}`);
      expect(gone.status).toBe(404);
      expect(errorOf(gone).code).toBe("SHIPPING_GUIDE_DRAFT_NOT_FOUND");
      expect(await fiscalTrace()).toEqual({ documents: 0, reservations: 0, guides: 0 });
    });

    it("un borrador emitido no se consulta, corrige ni elimina", async () => {
      const draft = await createDraft();
      const prisma = db.database.prisma;
      const guide = await insertShippingGuide(
        prisma,
        {
          companyId: a.companyId,
          adminId: a.adminId,
          points: [
            { establishmentId: a.establishmentId, emissionPointId: a.emissionPointId, code: "001" },
          ],
        },
        "SIGNED",
        {
          issueDate: "2026-10-06",
          recipients: [
            { identification: "0992877878001", name: "EL PERNO CIA. LTDA.", partyId: a.customerId },
          ],
        },
      );
      await prisma.shippingGuideDraft.update({
        where: { id: draft.id },
        data: { status: "EMITTED", documentId: guide.id },
      });
      for (const [method, body] of [
        ["get", undefined],
        ["put", { ...draftBody(), expectedVersion: 1 }],
        ["delete", undefined],
      ] as const) {
        const res = await call(
          a.cookies.operator,
          method,
          `/shipping-guides/drafts/${draft.id}`,
        ).send(body);
        expect(res.status, method).toBe(409);
        expect(errorOf(res).code).toBe("SHIPPING_GUIDE_DRAFT_ALREADY_EMITTED");
      }
    });
  });

  describe("acceso y aislamiento", () => {
    it("sin el permiso del borrador es 403 y sin sesión 401", async () => {
      for (const path of [
        "/shipping-guides/carriers",
        "/shipping-guides/recipients",
        "/shipping-guides/eligible-invoices",
        "/shipping-guides/options",
        "/shipping-guides/drafts",
      ]) {
        const forbidden = await call(a.cookies.operator, "get", path, denied);
        expect(forbidden.status, path).toBe(403);
        const anonymous = await request(api.app).get(`/api/v1${path}`);
        expect(anonymous.status, path).toBe(401);
      }
    });

    it("las escrituras del borrador sin el permiso son 403 y sin sesión 401, sin cambiarlo", async () => {
      const draft = await createDraft();
      const writes = [
        ["post", "/shipping-guides/drafts", draftBody()],
        [
          "put",
          `/shipping-guides/drafts/${draft.id}`,
          { ...draftBody({ plate: "PZZ-9999" }), expectedVersion: draft.version },
        ],
        ["delete", `/shipping-guides/drafts/${draft.id}`, undefined],
      ] as const;
      for (const [method, path, body] of writes) {
        const forbidden = await call(a.cookies.operator, method, path, denied).send(body);
        expect(forbidden.status, `${method} ${path}`).toBe(403);
        const anonymous = await request(api.app)[method](`/api/v1${path}`).send(body);
        expect(anonymous.status, `${method} ${path}`).toBe(401);
      }
      const unchanged = await call(
        a.cookies.operator,
        "get",
        `/shipping-guides/drafts/${draft.id}`,
      );
      expect([unchanged.status, dataOf<ShippingGuideDraftView>(unchanged).plate]).toEqual([
        200,
        "PAA-1234",
      ]);
    });

    it("el borrador y las referencias de otra empresa responden 404", async () => {
      const draft = await createDraft();
      const other = await call(b.cookies.operator, "get", `/shipping-guides/drafts/${draft.id}`);
      expect(other.status).toBe(404);
      expect(errorOf(other).code).toBe("SHIPPING_GUIDE_DRAFT_NOT_FOUND");
      const otherDelete = await call(
        b.cookies.operator,
        "delete",
        `/shipping-guides/drafts/${draft.id}`,
      );
      expect(otherDelete.status).toBe(404);
      // Un borrador válido de B, con su tercero y su producto; cada caso cambia una referencia por
      // una de A.
      const bRecipient = (overrides: Record<string, unknown> = {}) => ({
        recipient: { kind: "PARTY", partyId: b.customerId },
        address: "Av. Simón Bolívar S/N",
        motive: "Consignación",
        support: { kind: "DECLARED_EXCEPTION", case: "CONSIGNMENT" },
        details: [{ productId: b.productId, description: "Cemento", quantity: "1" }],
        ...overrides,
      });
      const bBody = (overrides: Record<string, unknown> = {}) => ({
        ...draftBody({ emissionPointId: b.emissionPointId, recipients: [bRecipient()] }),
        ...overrides,
      });
      expect(
        (await call(b.cookies.operator, "post", "/shipping-guides/drafts").send(bBody())).status,
      ).toBe(201);
      const cases: [Record<string, unknown>, number, string][] = [
        [bBody({ emissionPointId: a.emissionPointId }), 400, "EMISSION_POINT_NOT_FOUND"],
        [
          bBody({ transporter: { source: "PARTY", partyId: carrierId } }),
          404,
          "SHIPPING_GUIDE_CARRIER_NOT_FOUND",
        ],
        [
          bBody({
            recipients: [bRecipient({ recipient: { kind: "PARTY", partyId: a.customerId } })],
          }),
          404,
          "SHIPPING_GUIDE_RECIPIENT_NOT_FOUND",
        ],
        [
          bBody({ originEstablishmentId: a.establishmentId }),
          404,
          "SHIPPING_GUIDE_ESTABLISHMENT_NOT_FOUND",
        ],
        [
          bBody({
            recipients: [
              bRecipient({
                details: [{ productId: a.productId, description: "Cemento", quantity: "1" }],
              }),
            ],
          }),
          404,
          "SHIPPING_GUIDE_PRODUCT_NOT_FOUND",
        ],
        [
          bBody({
            recipients: [
              bRecipient({ support: { kind: "INTERNAL_INVOICE", invoiceId: invoice.id } }),
            ],
          }),
          404,
          "SHIPPING_GUIDE_INVOICE_NOT_FOUND",
        ],
        [{ fromInvoiceId: invoice.id }, 404, "SHIPPING_GUIDE_INVOICE_NOT_FOUND"],
      ];
      for (const [body, status, code] of cases) {
        const res = await call(b.cookies.operator, "post", "/shipping-guides/drafts").send(body);
        expect(res.status, code).toBe(status);
        expect(errorOf(res).code).toBe(code);
      }
    });
  });
});

// Cada ruta de /api/v1 que atiende Express está documentada en el registro de OpenAPI, y viceversa.
import type { Router } from "express";
import { describe, expect, it } from "vitest";
import { apiRoutes } from "@facturador/contracts";
import type { Authorizer } from "../../src/modules/identity/application/authorization.ts";
import type { UserAdministration } from "../../src/modules/identity/application/user-administration.ts";
import { usersRouter } from "../../src/modules/identity/infrastructure/http/users-router.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { taxpayerRouters } from "../../src/modules/taxpayer/infrastructure/index.ts";
import { fiscalRouters } from "../../src/modules/fiscal/infrastructure/index.ts";
import type { SigningCertificates } from "../../src/modules/signing/application/signing-certificate.ts";
import { signingCertificateRouter } from "../../src/modules/signing/infrastructure/http/signing-certificate-router.ts";
import type { FiscalCatalogs } from "../../src/modules/catalogs/application/fiscal-catalogs.ts";
import { fiscalCatalogsRouter } from "../../src/modules/catalogs/infrastructure/http/fiscal-catalogs-router.ts";
import type { Parties } from "../../src/modules/parties/application/parties.ts";
import { partiesRouter } from "../../src/modules/parties/infrastructure/http/parties-router.ts";
import type { Products } from "../../src/modules/products/application/products.ts";
import { productsRouter } from "../../src/modules/products/infrastructure/http/products-router.ts";
import type { Drafts } from "../../src/modules/invoices/application/drafts.ts";
import type { Emission } from "../../src/modules/invoices/application/emission.ts";
import type { Invoices } from "../../src/modules/invoices/application/invoices.ts";
import { invoicesRouter } from "../../src/modules/invoices/infrastructure/http/invoices-router.ts";
import type { CreditNotes } from "../../src/modules/credit-notes/application/credit-notes.ts";
import type { CreditNoteDrafts } from "../../src/modules/credit-notes/application/drafts.ts";
import type { CreditNoteEmission } from "../../src/modules/credit-notes/application/emission.ts";
import { creditNotesRouter } from "../../src/modules/credit-notes/infrastructure/http/credit-notes-router.ts";
import type { DebitNotes } from "../../src/modules/debit-notes/application/debit-notes.ts";
import type { DebitNoteDrafts } from "../../src/modules/debit-notes/application/drafts.ts";
import type { DebitNoteEmission } from "../../src/modules/debit-notes/application/emission.ts";
import { debitNotesRouter } from "../../src/modules/debit-notes/infrastructure/http/debit-notes-router.ts";
import type { WithholdingDrafts } from "../../src/modules/withholding-receipts/application/drafts.ts";
import type { WithholdingEmission } from "../../src/modules/withholding-receipts/application/emission.ts";
import type { WithholdingOptions } from "../../src/modules/withholding-receipts/application/options.ts";
import type { WithholdingReceipts } from "../../src/modules/withholding-receipts/application/withholding-receipts.ts";
import { withholdingReceiptsRouter } from "../../src/modules/withholding-receipts/infrastructure/http/withholding-receipts-router.ts";
import type { ShippingGuideDrafts } from "../../src/modules/shipping-guides/application/drafts.ts";
import type { ShippingGuideEmission } from "../../src/modules/shipping-guides/application/emission.ts";
import type { ShippingGuideOptions } from "../../src/modules/shipping-guides/application/options.ts";
import type { ShippingGuides } from "../../src/modules/shipping-guides/application/shipping-guides.ts";
import { shippingGuidesRouter } from "../../src/modules/shipping-guides/infrastructure/http/shipping-guides-router.ts";
import { archiveRouters } from "../../src/modules/fiscal/infrastructure/archive/index.ts";
import type { PurchaseSettlementDrafts } from "../../src/modules/purchase-settlements/application/drafts.ts";
import type { PurchaseSettlementEmission } from "../../src/modules/purchase-settlements/application/emission.ts";
import type { PurchaseSettlementOptions } from "../../src/modules/purchase-settlements/application/options.ts";
import type { PurchaseSettlements } from "../../src/modules/purchase-settlements/application/purchase-settlements.ts";
import { purchaseSettlementsRouter } from "../../src/modules/purchase-settlements/infrastructure/http/purchase-settlements-router.ts";
import type { Inventory } from "../../src/modules/inventory/application/inventory.ts";
import { inventoryRouter } from "../../src/modules/inventory/infrastructure/http/inventory-router.ts";
import type { JobStore } from "../../src/platform/jobs/jobs.ts";

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

function served(router: Router): string[] {
  return (router as unknown as { stack: Layer[] }).stack.flatMap((layer) =>
    layer.route
      ? Object.keys(layer.route.methods).map((method) => `${method} ${layer.route!.path}`)
      : [],
  );
}

describe("rutas documentadas", () => {
  it("el registro de OpenAPI coincide con las rutas de los routers de /api/v1", () => {
    // Los routers solo se inspeccionan: ninguna dependencia se usa al construirlos.
    const routers = [
      usersRouter({} as UserAdministration),
      ...taxpayerRouters({
        prisma: {} as PrismaClient,
        authorizer: {} as Authorizer,
        logoMaxBytes: 1,
      }),
      ...fiscalRouters({ prisma: {} as PrismaClient, authorizer: {} as Authorizer }),
      signingCertificateRouter({} as SigningCertificates, { maxBytes: 1 }),
      fiscalCatalogsRouter({} as FiscalCatalogs),
      partiesRouter({} as Parties),
      inventoryRouter({} as Inventory),
      productsRouter({} as Products),
      invoicesRouter({ drafts: {} as Drafts, emission: {} as Emission, invoices: {} as Invoices }),
      creditNotesRouter({
        drafts: {} as CreditNoteDrafts,
        emission: {} as CreditNoteEmission,
        creditNotes: {} as CreditNotes,
      }),
      debitNotesRouter({
        drafts: {} as DebitNoteDrafts,
        emission: {} as DebitNoteEmission,
        debitNotes: {} as DebitNotes,
      }),
      withholdingReceiptsRouter({
        drafts: {} as WithholdingDrafts,
        options: {} as WithholdingOptions,
        emission: {} as WithholdingEmission,
        withholdings: {} as WithholdingReceipts,
      }),
      shippingGuidesRouter({
        drafts: {} as ShippingGuideDrafts,
        options: {} as ShippingGuideOptions,
        emission: {} as ShippingGuideEmission,
        guides: {} as ShippingGuides,
      }),
      purchaseSettlementsRouter({
        drafts: {} as PurchaseSettlementDrafts,
        options: {} as PurchaseSettlementOptions,
        emission: {} as PurchaseSettlementEmission,
        settlements: {} as PurchaseSettlements,
      }),
      ...archiveRouters({
        prisma: {} as PrismaClient,
        authorizer: {} as Authorizer,
        jobs: {} as JobStore,
        rideSettings: { maxAttempts: 1, backoff: { baseMs: 1, capMs: 1, minMs: 1 } },
      }),
    ];
    const documented = apiRoutes.map((route) => `${route.method} ${route.path}`).sort();
    expect(routers.flatMap(served).sort()).toEqual(documented);
  });

  it("ninguna ruta envía al SRI, recibe, autoriza ni expone SOAP (add-sri-transmission, D18)", () => {
    // Solo hay lecturas (historial y política de tamaño) y la reconciliación del administrador.
    const sri = apiRoutes
      .filter((route) =>
        /send|submit|soap|recep|autoriz|authoriz|transmi|reconcil/i.test(route.path),
      )
      .map((route) => `${route.method} ${route.path}`)
      .sort();
    // La descarga del XML autorizado lee un artefacto guardado: no habla con el SRI.
    expect(sri).toEqual(
      [
        "get /credit-notes/:creditNoteId/transmission",
        "get /debit-notes/:debitNoteId/transmission",
        "get /documents/:documentId/authorized-xml",
        "get /fiscal-catalogs/sri-transmission-policy",
        "get /invoices/:invoiceId/transmission",
        "post /credit-notes/:creditNoteId/reconciliations",
        "post /debit-notes/:debitNoteId/reconciliations",
        "post /invoices/:invoiceId/reconciliations",
        "get /withholding-receipts/:withholdingReceiptId/transmission",
        "post /withholding-receipts/:withholdingReceiptId/reconciliations",
        "get /shipping-guides/:shippingGuideId/transmission",
        "post /shipping-guides/:shippingGuideId/reconciliations",
      ].sort(),
    );
  });

  it("ninguna ruta permite bloquear ni desbloquear la identidad tributaria", () => {
    expect(apiRoutes.filter((route) => /lock|bloque/i.test(route.path))).toEqual([]);
  });

  it("ninguna ruta descarga la firma, su archivo ni su contraseña (ADR 0011)", () => {
    const signing = apiRoutes.filter((route) => /certificate/i.test(route.path));
    expect(signing.map((route) => `${route.method} ${route.path}`).sort()).toEqual([
      "get /signing-certificate",
      "get /signing-certificate/validity",
      "put /signing-certificate",
      "put /signing-certificate/expiry-alert",
    ]);
    expect(apiRoutes.filter((route) => /p12|pfx|password|download|file/i.test(route.path))).toEqual(
      apiRoutes.filter((route) => /\/users\/:userId\/password/.test(route.path)),
    );
  });

  it("ninguna ruta reserva secuenciales (add-fiscal-numbering, design D4)", () => {
    expect(apiRoutes.filter((route) => /reserv/i.test(route.path))).toEqual([]);
    const writes = apiRoutes.filter(
      (route) => route.method !== "get" && /sequence/i.test(route.path),
    );
    expect(writes.map((route) => `${route.method} ${route.path}`)).toEqual([
      "put /establishments/:establishmentId/emission-points/:emissionPointId/sequences/:environment/:documentType",
    ]);
  });
});

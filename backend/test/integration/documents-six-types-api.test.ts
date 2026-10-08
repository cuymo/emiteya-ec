// La bandeja con los seis tipos emitidos (add-shipping-guides, tarea 11.2; add-purchase-settlements,
// tarea 11.1, design D20): una factura, una liquidación de compra, una nota de crédito, una nota de
// débito, una guía de remisión y un comprobante de retención de una misma empresa se listan juntos con
// su tipo; la guía, sin total ni comprador y con su destinatario; los demás, con su comprador (en la
// liquidación, su proveedor como contraparte) y su total; y el filtro por tipo deja solo los de ese
// tipo, también el de liquidación de compra.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentListItem } from "@facturador/contracts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import { archiveCompany, buildArchiveApp, type ArchiveCompany } from "./archive-api-harness.ts";
import { insertAuthorizedInvoice, insertCreditNote } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertDebitNote } from "./debit-notes-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { insertPurchaseSettlement, insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import { insertGuideParty, insertShippingGuide } from "./shipping-guide-harness.ts";
import { insertSupplier, insertWithholding } from "./withholding-harness.ts";

const bodyOf = (res: { body: unknown }) => res.body as { data: DocumentListItem[] };

describe("bandeja con los seis tipos emitidos", () => {
  let db: MigratedSchema;
  let api: ReturnType<typeof buildArchiveApp>;
  let a: ArchiveCompany;
  const docs: Record<"01" | "03" | "04" | "05" | "06" | "07", string> = {
    "01": "",
    "03": "",
    "04": "",
    "05": "",
    "06": "",
    "07": "",
  };

  const list = (query: Record<string, string> = {}) =>
    request(api.app)
      .get("/api/v1/documents")
      .query({ pageSize: "100", ...query })
      .set("Cookie", a.cookies.operator);

  beforeAll(async () => {
    db = await createMigratedSchema("documents_six_types");
    api = buildArchiveApp(db);
    a = await archiveCompany(db, api, "Seis tipos");
    const prisma = db.database.prisma;
    // El producto de la factura referencia la tarifa de IVA del catálogo.
    await loadInstalledFiscalCatalogs(prisma);
    const productId = await insertProduct(prisma, a);
    const invoice = await insertAuthorizedInvoice(
      prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: a.points[0]!.establishmentId,
        emissionPointId: a.points[0]!.emissionPointId,
      },
      [{ productId, quantity: "10", unitPrice: "8.75" }],
    );
    docs["01"] = invoice.id;
    docs["03"] = (
      await insertPurchaseSettlement(
        prisma,
        a,
        await insertPurchaseSupplier(prisma, a, "1710034065", { legalName: "María Quishpe" }),
        "SIGNED",
        { buyer: { identification: "1710034065", name: "María Quishpe" } },
      )
    ).id;
    docs["04"] = (
      await insertCreditNote(prisma, a, invoice, { lines: [{ position: 1, quantity: "2" }] })
    ).id;
    docs["05"] = (await insertDebitNote(prisma, a, invoice.id, "SIGNED")).id;
    docs["06"] = (
      await insertShippingGuide(prisma, a, "SIGNED", {
        recipients: [
          {
            identification: "0102030405",
            name: "María Pérez",
            partyId: await insertGuideParty(prisma, a, "0102030405", { legalName: "María Pérez" }),
          },
        ],
      })
    ).id;
    docs["07"] = (await insertWithholding(prisma, a, await insertSupplier(prisma, a), "SIGNED")).id;
  }, 120_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("lista los seis con su tipo; la guía sin total ni comprador y los demás con su contraparte y su total", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const byId = new Map(bodyOf(res).data.map((item) => [item.id, item]));
    for (const [type, id] of Object.entries(docs)) {
      const item = byId.get(id);
      expect([type, item?.documentType]).toEqual([type, type]);
      if (type === "06") {
        expect(item).toMatchObject({
          buyer: null,
          total: null,
          recipients: { count: 1, name: "María Pérez" },
        });
      } else if (type === "03") {
        // La liquidación lleva a su proveedor en las columnas genéricas de la contraparte.
        expect(item).toMatchObject({
          buyer: { identification: "1710034065", name: "María Quishpe" },
          recipients: null,
        });
        expect(Number(item?.total)).toBe(106);
      } else {
        // Los documentos monetarios conservan su comprador y su total, sin destinatarios.
        expect([type, item?.buyer]).toEqual([
          type,
          { identification: expect.any(String) as string, name: expect.any(String) as string },
        ]);
        expect([type, Number(item?.total)]).toEqual([type, expect.any(Number) as number]);
        expect([type, Number(item?.total) > 0, item?.recipients]).toEqual([type, true, null]);
      }
    }
    expect(
      bodyOf(res)
        .data.map((item) => item.documentType)
        .sort(),
    ).toEqual(["01", "03", "04", "05", "06", "07"]);
  });

  it("el filtro por tipo deja solo los de ese tipo: el de liquidación de compra, solo la liquidación", async () => {
    for (const [type, id] of Object.entries(docs)) {
      const res = await list({ documentType: type });
      expect([type, res.status, bodyOf(res).data.map((item) => item.id)]).toEqual([
        type,
        200,
        [id],
      ]);
    }
  });
});

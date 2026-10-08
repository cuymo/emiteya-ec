// Fuentes de Documentos emitidos y de Facturas (add-reports-export, tarea 3.1, design D2, D3 y D5):
// cada filtro, el orden total con su desempate, el conteo, la página y los lotes del cursor con las
// mismas filas, los importes de los seis tipos desde su snapshot (con el IVA y los otros impuestos
// por separado en Facturas), ningún borrador, el tercero congelado al emitir y otra empresa ausente.
import { canonicalDecimal, type IssuedDocumentRow } from "@facturador/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type {
  InvoicesSourceFilters,
  IssuedDocumentsSourceFilters,
} from "../../src/modules/fiscal/infrastructure/index.ts";
import { insertAuthorizedInvoice, insertCreditNote } from "./credit-notes-harness.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertDebitNote } from "./debit-notes-harness.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { insertPurchaseSettlement, insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import {
  allBatches,
  allPages,
  debitNoteAmounts,
  documentSources,
  insertWithholdingReceipt,
  invoiceAmounts,
  purchaseSettlementAmounts,
} from "./reports-harness.ts";
import { insertGuideParty, insertShippingGuide } from "./shipping-guide-harness.ts";
import { insertDocument } from "./transmission-harness.ts";
import { insertSupplier } from "./withholding-harness.ts";

const ISSUED: IssuedDocumentsSourceFilters = { state: "ALL", environment: "TEST" };
const INVOICES: InvoicesSourceFilters = { state: "ALL", environment: "TEST" };

type Totals = { withoutTaxes: string; taxes: { amount: string; taxCode: string }[] };
const sum = (values: readonly string[]) =>
  canonicalDecimal(values.reduce((acc, value) => (Number(acc) + Number(value)).toFixed(2), "0"));

describe("fuentes de Documentos emitidos y de Facturas", () => {
  let db: MigratedSchema;
  let sources: ReturnType<typeof documentSources>;
  let a: FiscalCompany;
  let b: FiscalCompany;
  const id = {} as Record<
    | "inv1"
    | "inv2"
    | "inv3"
    | "inv4"
    | "ps"
    | "cn"
    | "dn"
    | "wh"
    | "guide1"
    | "guide3"
    | "draft"
    | "other",
    string
  >;
  let invoiceTotals: Totals;
  let invoiceTotal: string;
  let customerPartyId: string;

  beforeAll(async () => {
    db = await createMigratedSchema("report_sources_documents");
    sources = documentSources(db.name);
    const prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    a = await insertFiscalCompany(prisma, "Empresa A", 2);
    b = await insertFiscalCompany(prisma, "Empresa B", 1);
    const p0 = a.points[0]!;
    const productId = await insertProduct(prisma, a);

    // Factura con el snapshot real de la emisión (IVA 15 %).
    const invoice = await insertAuthorizedInvoice(
      prisma,
      {
        companyId: a.companyId,
        adminId: a.adminId,
        establishmentId: p0.establishmentId,
        emissionPointId: p0.emissionPointId,
      },
      [{ productId, quantity: "10", unitPrice: "8.75" }],
      { issueDate: "2026-09-10" },
    );
    id.inv1 = invoice.id;
    invoiceTotals = invoice.snapshot.totals as unknown as Totals;
    invoiceTotal = invoice.total;
    id.ps = (
      await insertPurchaseSettlement(
        prisma,
        a,
        await insertPurchaseSupplier(prisma, a, "1710034065"),
        "AUTHORIZED",
        {
          total: "115.00",
          buyer: { identification: "1710034065", name: "María Quishpe" },
          snapshot: purchaseSettlementAmounts("100.00", "15.00", "115.00"),
          issueDate: "2026-09-05",
        },
      )
    ).id;
    const recipient = await insertGuideParty(prisma, a, "0912345678", { legalName: "Pedro Ruiz" });
    id.guide1 = (
      await insertShippingGuide(prisma, a, "AUTHORIZED", {
        issueDate: "2026-09-15",
        recipients: [{ identification: "0912345678", name: "Pedro Ruiz", partyId: recipient }],
      })
    ).id;
    // Cliente que se corrige después de emitir: la fila conserva lo congelado.
    customerPartyId = await insertGuideParty(prisma, a, "0102030405", {
      legalName: "Cliente Original",
      roles: ["CUSTOMER"],
    });
    id.inv2 = (
      await insertDocument(prisma, a, "AUTHORIZED", {
        documentType: "01",
        issueDate: "2026-09-20",
        buyer: { identification: "0102030405", name: "Cliente Original" },
        total: "120.00",
        snapshot: invoiceAmounts(
          "100.00",
          [
            { taxCode: "2", amount: "15.00" },
            { taxCode: "3", amount: "5.00" },
          ],
          "120.00",
        ),
      })
    ).id;
    // Misma fecha, creada después: va primero.
    id.inv3 = (
      await insertDocument(prisma, a, "NOT_AUTHORIZED", {
        documentType: "01",
        issueDate: "2026-09-20",
        total: "11.50",
        snapshot: invoiceAmounts("10.00", [{ taxCode: "2", amount: "1.50" }], "11.50"),
      })
    ).id;
    id.inv4 = (
      await insertDocument(prisma, a, "SIGNED", {
        documentType: "01",
        environment: "PRODUCTION",
        point: 1,
        issueDate: "2026-09-25",
        total: "11.50",
        snapshot: invoiceAmounts("10.00", [{ taxCode: "2", amount: "1.50" }], "11.50"),
      })
    ).id;
    id.dn = (
      await insertDebitNote(prisma, a, invoice.id, "AUTHORIZED", {
        total: "11.50",
        snapshot: debitNoteAmounts("10.00", [{ taxCode: "2", amount: "1.50" }], "11.50"),
        issueDate: "2026-09-28",
      })
    ).id;
    const supplier = await insertSupplier(prisma, a);
    id.wh = (
      await insertWithholdingReceipt(prisma, a, {
        partyId: supplier,
        state: "RETURNED",
        issueDate: "2026-10-01",
        fiscalPeriod: "09/2026",
        subject: { identification: "1791234567001", name: "Proveedor 1791234567001" },
        total: "13.00",
        lines: [
          {
            supportPosition: 1,
            position: 1,
            tax: "1",
            taxLabel: "RENTA",
            code: "303",
            base: "100.00",
            percentage: "10",
            amount: "10.00",
          },
          {
            supportPosition: 1,
            position: 2,
            tax: "2",
            taxLabel: "IVA",
            code: "725",
            base: "10.00",
            percentage: "30",
            amount: "3.00",
          },
        ],
      })
    ).id;
    const recipients = [];
    for (const [identification, name] of [
      ["0911111111", "Uno"],
      ["0922222222", "Dos"],
      ["0933333333", "Tres"],
    ] as const) {
      recipients.push({
        identification,
        name,
        partyId: await insertGuideParty(prisma, a, identification, { legalName: name }),
      });
    }
    id.guide3 = (
      await insertShippingGuide(prisma, a, "RESERVED", { issueDate: "2026-10-02", recipients })
    ).id;
    id.cn = (
      await insertCreditNote(prisma, a, invoice, {
        lines: [{ position: 1, quantity: "2" }],
        // Recibida: una nota autorizada exige su reserva aplicada, que este arnés no aplica.
        state: "RECEIVED",
        freezeTotals: true,
      })
    ).id;
    // Un borrador nunca es un comprobante.
    id.draft = (
      await prisma.invoiceDraft.create({
        data: { companyId: a.companyId, createdBy: a.adminId, updatedBy: a.adminId },
      })
    ).id;
    // El cliente corrige su razón social después de emitir.
    await prisma.party.update({
      where: { id: customerPartyId },
      data: { legalName: "Cliente Corregido", searchName: "cliente corregido" },
    });
    id.other = (
      await insertDocument(prisma, b, "AUTHORIZED", {
        documentType: "01",
        issueDate: "2026-09-10",
        total: "11.50",
        snapshot: invoiceAmounts("10.00", [{ taxCode: "2", amount: "1.50" }], "11.50"),
      })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await db?.drop();
  });

  const issued = (filters: Partial<IssuedDocumentsSourceFilters> = {}) =>
    allPages(db.database.prisma, sources.issued, a.companyId, { ...ISSUED, ...filters });
  const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

  it("lista los comprobantes del ambiente en el orden total, sin borradores ni otra empresa", async () => {
    const rows = await issued();
    expect(ids(rows)).toEqual([
      id.cn,
      id.guide3,
      id.wh,
      id.dn,
      id.inv3,
      id.inv2,
      id.guide1,
      id.inv1,
      id.ps,
    ]);
    expect(ids(rows)).not.toContain(id.draft);
    expect(ids(rows)).not.toContain(id.other);
    const prisma = db.database.prisma;
    expect(await sources.issued.count(prisma, a.companyId, ISSUED)).toBe(rows.length);
  });

  it("recorre con el cursor exactamente las mismas filas que las páginas, con su conteo", async () => {
    const prisma = db.database.prisma;
    for (const filters of [ISSUED, { ...ISSUED, environment: "ALL" as const }]) {
      const pages = await allPages(prisma, sources.issued, a.companyId, filters, 3);
      const cursor = await allBatches(prisma, sources.issued, a.companyId, filters, 2);
      expect(cursor.rows).toEqual(pages);
      expect(cursor.count).toBe(pages.length);
      expect(cursor.batches).toBe(Math.ceil(pages.length / 2));
    }
  });

  it("filtra por ambiente, estado, tipo, rango de emisión, establecimiento y punto", async () => {
    expect(ids(await issued({ environment: "PRODUCTION" }))).toEqual([id.inv4]);
    const all = ids(await issued({ environment: "ALL" }));
    expect(all.indexOf(id.inv4)).toBe(all.indexOf(id.dn) + 1);
    expect(ids(await issued({ state: "AUTHORIZED" }))).toEqual([
      id.dn,
      id.inv2,
      id.guide1,
      id.inv1,
      id.ps,
    ]);
    expect(ids(await issued({ documentType: "06" }))).toEqual([id.guide3, id.guide1]);
    expect(ids(await issued({ from: "2026-09-20", to: "2026-09-28" }))).toEqual([
      id.dn,
      id.inv3,
      id.inv2,
    ]);
    const second = a.points[1]!;
    expect(
      ids(await issued({ environment: "ALL", establishmentId: second.establishmentId })),
    ).toEqual([id.inv4]);
    expect(
      ids(await issued({ environment: "ALL", emissionPointId: second.emissionPointId })),
    ).toEqual([id.inv4]);
  });

  it("muestra los importes de cada tipo desde su snapshot, sin compensar y sin inventar ceros", async () => {
    const byId = new Map((await issued()).map((row) => [row.id, row]));
    const amounts = (row: IssuedDocumentRow | undefined) => [row?.subtotal, row?.taxes, row?.total];
    expect(amounts(byId.get(id.inv1))).toEqual([
      canonicalDecimal(invoiceTotals.withoutTaxes),
      sum(invoiceTotals.taxes.map((tax) => tax.amount)),
      canonicalDecimal(invoiceTotal),
    ]);
    expect(amounts(byId.get(id.inv2))).toEqual(["100", "20", "120"]);
    expect(amounts(byId.get(id.ps))).toEqual(["100", "15", "115"]);
    expect(amounts(byId.get(id.dn))).toEqual(["10", "1.5", "11.5"]);
    expect(amounts(byId.get(id.wh))).toEqual([null, null, "13"]);
    expect(amounts(byId.get(id.guide1))).toEqual([null, null, null]);
    const note = await db.database.prisma.electronicDocument.findUniqueOrThrow({
      where: { id: id.cn },
      select: { snapshot: true, total: true },
    });
    const noteTotals = (note.snapshot as { totals: Totals }).totals;
    expect(amounts(byId.get(id.cn))).toEqual([
      canonicalDecimal(noteTotals.withoutTaxes),
      sum(noteTotals.taxes.map((tax) => tax.amount)),
      canonicalDecimal(note.total!.toFixed()),
    ]);
  });

  it("muestra el tercero de cada tipo: la guía con su único destinatario o su cantidad", async () => {
    const byId = new Map((await issued()).map((row) => [row.id, row]));
    expect(byId.get(id.guide1)).toMatchObject({
      counterpart: { identification: "0912345678", name: "Pedro Ruiz" },
      recipientCount: 1,
    });
    expect(byId.get(id.guide3)).toMatchObject({ counterpart: null, recipientCount: 3 });
    expect(byId.get(id.ps)).toMatchObject({
      counterpart: { identification: "1710034065", name: "María Quishpe" },
      recipientCount: null,
    });
    expect(byId.get(id.wh)?.counterpart).toEqual({
      identification: "1791234567001",
      name: "Proveedor 1791234567001",
    });
    // Corregido después de emitir: la fila conserva la razón social congelada.
    expect(byId.get(id.inv2)?.counterpart).toEqual({
      identification: "0102030405",
      name: "Cliente Original",
    });
    expect(byId.get(id.inv2)).toMatchObject({ state: "AUTHORIZED", environment: "TEST" });
    expect(byId.get(id.inv2)?.issueDate).toBe("2026-09-20");
  });

  it("lista en Facturas solo facturas, con el IVA y los otros impuestos por separado", async () => {
    const prisma = db.database.prisma;
    const rows = await allPages(prisma, sources.invoices, a.companyId, INVOICES);
    expect(ids(rows)).toEqual([id.inv3, id.inv2, id.inv1]);
    const inv2 = rows.find((row) => row.id === id.inv2);
    expect(inv2).toMatchObject({
      customer: { identification: "0102030405", name: "Cliente Original" },
      subtotal: "100",
      vat: "15",
      otherTaxes: "5",
      total: "120",
    });
    const inv1 = rows.find((row) => row.id === id.inv1);
    expect(inv1).toMatchObject({
      vat: sum(invoiceTotals.taxes.filter((tax) => tax.taxCode === "2").map((tax) => tax.amount)),
      otherTaxes: "0",
    });
    expect(
      ids(
        await allPages(prisma, sources.invoices, a.companyId, {
          ...INVOICES,
          customerIdentification: "0102030405",
        }),
      ),
    ).toEqual([id.inv2]);
    expect(
      ids(
        await allPages(prisma, sources.invoices, a.companyId, { ...INVOICES, state: "AUTHORIZED" }),
      ),
    ).toEqual([id.inv2, id.inv1]);
    expect(await sources.invoices.count(prisma, a.companyId, INVOICES)).toBe(3);
    const cursor = await allBatches(prisma, sources.invoices, a.companyId, INVOICES, 2);
    expect(cursor.rows).toEqual(rows);
  });

  it("aísla cada empresa", async () => {
    const prisma = db.database.prisma;
    expect(ids(await allPages(prisma, sources.issued, b.companyId, ISSUED))).toEqual([id.other]);
    expect(ids(await allPages(prisma, sources.invoices, b.companyId, INVOICES))).toEqual([
      id.other,
    ]);
    // Un establecimiento de otra empresa no alcanza nada.
    expect(
      await issued({ environment: "ALL", establishmentId: b.points[0]!.establishmentId }),
    ).toEqual([]);
  });
});

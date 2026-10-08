// Fuente de Retenciones (add-reports-export, tarea 3.2, design D2, D3 y D5): una fila por línea con
// lo que la retención congeló al reservar, el filtro por período fiscal distinto de la fecha de
// emisión, el orden por comprobante, sustento y línea, el conteo, los lotes del cursor y otra
// empresa ausente.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import type { WithholdingsSourceFilters } from "../../src/modules/withholding-receipts/infrastructure/index.ts";
import { createMigratedSchema, type MigratedSchema } from "./database.ts";
import { insertFiscalCompany, type FiscalCompany } from "./fiscal-harness.ts";
import {
  allBatches,
  allPages,
  documentSources,
  insertWithholdingReceipt,
} from "./reports-harness.ts";
import { insertSupplier } from "./withholding-harness.ts";

const FILTERS: WithholdingsSourceFilters = { state: "ALL", environment: "TEST" };

const line = (
  supportPosition: number,
  position: number,
  overrides: Partial<Parameters<typeof insertWithholdingReceipt>[2]["lines"][number]> = {},
) => ({
  supportPosition,
  position,
  tax: "1" as const,
  // Una denominación que no existe en el catálogo: la fila sale del snapshot, nunca del catálogo.
  taxLabel: "RENTA (congelada)",
  code: "303",
  base: "100.00",
  percentage: "10",
  amount: "10.00",
  ...overrides,
});

describe("fuente de Retenciones", () => {
  let db: MigratedSchema;
  let sources: ReturnType<typeof documentSources>;
  let a: FiscalCompany;
  let b: FiscalCompany;
  const id = {} as Record<"september" | "october" | "returned" | "production" | "other", string>;

  beforeAll(async () => {
    db = await createMigratedSchema("report_sources_withholdings");
    sources = documentSources(db.name);
    const prisma = db.database.prisma;
    await loadInstalledFiscalCatalogs(prisma);
    a = await insertFiscalCompany(prisma, "Empresa A", 1);
    b = await insertFiscalCompany(prisma, "Empresa B", 1);
    const supplier = await insertSupplier(prisma, a, "1791234567001");
    const other = await insertSupplier(prisma, a, "1798765432001");
    const subject = { identification: "1791234567001", name: "Proveedor Uno" };
    // Período de septiembre emitido en octubre: dos sustentos con tres líneas.
    id.september = (
      await insertWithholdingReceipt(prisma, a, {
        partyId: supplier,
        state: "AUTHORIZED",
        issueDate: "2026-10-03",
        fiscalPeriod: "09/2026",
        subject,
        total: "13.00",
        lines: [
          line(2, 1, {
            tax: "2",
            taxLabel: "IVA",
            code: "725",
            base: "10.00",
            percentage: "30",
            amount: "3.00",
          }),
          line(1, 1),
          line(1, 2, { code: "312", base: "50.00", percentage: "1.75", amount: "0.88" }),
        ],
      })
    ).id;
    id.october = (
      await insertWithholdingReceipt(prisma, a, {
        partyId: other,
        state: "AUTHORIZED",
        issueDate: "2026-10-05",
        fiscalPeriod: "10/2026",
        subject: { identification: "1798765432001", name: "Proveedor Dos" },
        total: "10.00",
        lines: [line(1, 1)],
      })
    ).id;
    id.returned = (
      await insertWithholdingReceipt(prisma, a, {
        partyId: supplier,
        state: "RETURNED",
        issueDate: "2026-10-04",
        fiscalPeriod: "10/2026",
        subject,
        total: "10.00",
        lines: [line(1, 1)],
      })
    ).id;
    id.production = (
      await insertWithholdingReceipt(prisma, a, {
        partyId: supplier,
        state: "AUTHORIZED",
        environment: "PRODUCTION",
        issueDate: "2026-10-04",
        fiscalPeriod: "10/2026",
        subject,
        total: "10.00",
        lines: [line(1, 1)],
      })
    ).id;
    id.other = (
      await insertWithholdingReceipt(prisma, b, {
        partyId: await insertSupplier(prisma, b),
        state: "AUTHORIZED",
        issueDate: "2026-10-04",
        fiscalPeriod: "10/2026",
        subject,
        total: "10.00",
        lines: [line(1, 1)],
      })
    ).id;
    // El sujeto corrige su razón social después de emitir.
    await prisma.party.update({
      where: { id: supplier },
      data: { legalName: "Proveedor Corregido" },
    });
  }, 180_000);

  afterAll(async () => {
    await db?.drop();
  });

  const rows = (filters: Partial<WithholdingsSourceFilters> = {}, companyId = a.companyId) =>
    allPages(db.database.prisma, sources.withholdings, companyId, { ...FILTERS, ...filters });
  const keys = (
    list: readonly { documentId: string; supportPosition: number; position: number }[],
  ) => list.map((row) => `${row.documentId}:${row.supportPosition}:${row.position}`);

  it("lista una fila por línea, en el orden del comprobante, del sustento y de la línea", async () => {
    const list = await rows();
    expect(keys(list)).toEqual([
      `${id.october}:1:1`,
      `${id.returned}:1:1`,
      `${id.september}:1:1`,
      `${id.september}:1:2`,
      `${id.september}:2:1`,
    ]);
    expect(await sources.withholdings.count(db.database.prisma, a.companyId, FILTERS)).toBe(5);
  });

  it("muestra lo congelado: sujeto, período, impuesto, código, base, porcentaje y valor", async () => {
    const list = await rows({ fiscalPeriod: "2026-09" });
    expect(list).toEqual([
      {
        documentId: id.september,
        supportPosition: 1,
        position: 1,
        issueDate: "2026-10-03",
        number: expect.any(String) as string,
        supplier: { identification: "1791234567001", name: "Proveedor Uno" },
        fiscalPeriod: "09/2026",
        tax: "1",
        taxLabel: "RENTA (congelada)",
        code: "303",
        base: "100",
        percentage: "10",
        amount: "10",
        state: "AUTHORIZED",
        environment: "TEST",
      },
      expect.objectContaining({ position: 2, code: "312", percentage: "1.75", amount: "0.88" }),
      expect.objectContaining({ supportPosition: 2, tax: "2", taxLabel: "IVA", amount: "3" }),
    ]);
  });

  it("filtra por período fiscal aunque la retención se haya emitido en otro mes", async () => {
    expect(new Set((await rows({ fiscalPeriod: "2026-09" })).map((row) => row.documentId))).toEqual(
      new Set([id.september]),
    );
    expect(
      new Set((await rows({ from: "2026-10-01", to: "2026-10-31" })).map((row) => row.documentId)),
    ).toEqual(new Set([id.september, id.october, id.returned]));
  });

  it("filtra por estado, ambiente, rango e identificación del sujeto retenido", async () => {
    const documents = async (filters: Partial<WithholdingsSourceFilters>) => [
      ...new Set((await rows(filters)).map((row) => row.documentId)),
    ];
    expect(await documents({ state: "AUTHORIZED" })).toEqual([id.october, id.september]);
    expect(await documents({ state: "RETURNED" })).toEqual([id.returned]);
    expect(await documents({ environment: "PRODUCTION" })).toEqual([id.production]);
    expect((await documents({ environment: "ALL" })).length).toBe(4);
    expect(await documents({ from: "2026-10-04", to: "2026-10-04" })).toEqual([id.returned]);
    expect(await documents({ supplierIdentification: "1798765432001" })).toEqual([id.october]);
  });

  it("recorre con el cursor las mismas filas que las páginas", async () => {
    const prisma = db.database.prisma;
    const pages = await allPages(prisma, sources.withholdings, a.companyId, FILTERS, 2);
    const cursor = await allBatches(prisma, sources.withholdings, a.companyId, FILTERS, 2);
    expect(cursor.rows).toEqual(pages);
    expect(cursor.count).toBe(pages.length);
  });

  it("aísla cada empresa", async () => {
    expect(new Set((await rows({}, b.companyId)).map((row) => row.documentId))).toEqual(
      new Set([id.other]),
    );
    expect((await rows()).map((row) => row.documentId)).not.toContain(id.other);
  });
});

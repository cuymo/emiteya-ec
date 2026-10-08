// Arnés HTTP de los reportes (add-reports-export): la aplicación real con Better Auth, el contexto
// de petición y el router de reportes con las fuentes compuestas como en main.ts, un directorio de
// temporales propio para comprobar que siempre queda vacío, y datos de los cinco reportes.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Registry } from "@prometheus-io/client";
import { Router } from "express";
import type { Response } from "supertest";
import type { AuditLog } from "../../src/modules/audit/application/audit-log.ts";
import { createAuditLog } from "../../src/modules/audit/infrastructure/prisma-audit-log.ts";
import { loadInstalledFiscalCatalogs } from "../../src/modules/catalogs/infrastructure/index.ts";
import {
  createAuthorizer,
  type Authorizer,
} from "../../src/modules/identity/application/authorization.ts";
import {
  createInventoryMovementsReportSource,
  createStockRepository,
  inventoryBalanceReads,
} from "../../src/modules/inventory/infrastructure/index.ts";
import { createPartiesReportSource } from "../../src/modules/parties/infrastructure/index.ts";
import {
  createReportProductsSource,
  reportProductLabels,
} from "../../src/modules/products/infrastructure/index.ts";
import type { ReportSources, XlsxWriter } from "../../src/modules/reports/application/ports.ts";
import {
  createTemporaryFiles,
  registerReportMetrics,
  reportsModule,
} from "../../src/modules/reports/infrastructure/index.ts";
import {
  currentEnvironment,
  reportPointCodes,
} from "../../src/modules/taxpayer/infrastructure/index.ts";
import { ForbiddenError } from "../../src/platform/http/errors.ts";
import { randomUUID } from "node:crypto";
import { archiveCompany, type ArchiveCompany } from "./archive-api-harness.ts";
import { buildAuthApp } from "./auth-harness.ts";
import { insertAuthorizedInvoice, insertCreditNote } from "./credit-notes-harness.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { MigratedSchema } from "./database.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { insertDebitNote } from "./debit-notes-harness.ts";
import { insertProduct } from "./inventory-harness.ts";
import { insertPurchaseSettlement, insertPurchaseSupplier } from "./purchase-settlement-harness.ts";
import {
  debitNoteAmounts,
  documentSources,
  insertWithholdingReceipt,
  invoiceAmounts,
  purchaseSettlementAmounts,
} from "./reports-harness.ts";
import { insertGuideParty, insertShippingGuide } from "./shipping-guide-harness.ts";
import { insertDocument } from "./transmission-harness.ts";
import { insertSupplier } from "./withholding-harness.ts";

/** Las fuentes de los reportes, compuestas como en main.ts. */
export function reportSources(schema: string): ReportSources {
  const documents = documentSources(schema);
  return {
    issuedDocuments: documents.issued,
    invoices: documents.invoices,
    withholdings: documents.withholdings,
    inventoryMovements: createInventoryMovementsReportSource(schema),
    products: createReportProductsSource(schema),
    productLabels: reportProductLabels,
    initializedProductIds: inventoryBalanceReads.initializedProductIds,
    balances: inventoryBalanceReads.balances,
    parties: createPartiesReportSource(schema),
    currentEnvironment,
    pointCodes: reportPointCodes,
  };
}

export type ReportsAppOptions = {
  maxRows?: number;
  maxConcurrent?: number;
  writer?: XlsxWriter;
  audit?: (prisma: MigratedSchema["database"]["prisma"]) => AuditLog;
  /** Una política que no concede los permisos de reportes, sin inventar un rol. */
  denyReports?: boolean;
};

export function buildReportsApp(db: MigratedSchema, options: ReportsAppOptions = {}) {
  const metrics = new Registry();
  const temporaryRoot = mkdtempSync(join(tmpdir(), "reports-api-"));
  const app = buildAuthApp(db, {
    trustProxy: 1,
    apiRouter: ({ context, memberships, securityEvents }) => {
      const base = createAuthorizer({ memberships, securityEvents });
      const authorizer: Authorizer = options.denyReports
        ? {
            ...base,
            requirePermission: (ctx, permission) => {
              if (permission.startsWith("reports.")) throw new ForbiddenError();
              return base.requirePermission(ctx, permission);
            },
          }
        : base;
      return Router()
        .use(context)
        .use(
          ...reportsModule({
            prisma: db.database.prisma,
            authorizer,
            sources: reportSources(db.name),
            limits: {
              maxRows: options.maxRows ?? 100_000,
              maxConcurrent: options.maxConcurrent ?? 2,
            },
            observer: registerReportMetrics(metrics),
            temporaryFiles: createTemporaryFiles(temporaryRoot),
            ...(options.writer ? { writer: options.writer } : {}),
            ...(options.audit ? { audit: options.audit(db.database.prisma) } : {}),
          }).routers,
        );
    },
  });
  return {
    ...app,
    metrics,
    /** Archivos o directorios que quedan en el directorio de los temporales. */
    leftovers: () => readdirSync(temporaryRoot),
  };
}

/** Los bytes de una respuesta binaria de supertest. */
export function binary(res: Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

/** Los eventos `report.exported` de una empresa, del más reciente al más antiguo. */
export async function exportEvents(db: MigratedSchema, companyId: string) {
  const events = await createAuditLog(db.database.prisma).listForCompany(companyId);
  return events.filter((event) => event.action === "report.exported");
}

export type SeededCompany = ArchiveCompany & Readonly<{ ids: Record<string, string> }>;

/** Empresa con comprobantes de los seis tipos en los dos ambientes, retenciones, inventario y terceros. */
export async function seededCompany(
  db: MigratedSchema,
  app: Pick<Parameters<typeof archiveCompany>[1], "app" | "uow">,
  name: string,
): Promise<SeededCompany> {
  await loadInstalledFiscalCatalogs(db.database.prisma);
  // El arnés del archivo solo usa la aplicación y la unidad de trabajo para los usuarios.
  const company = await archiveCompany(db, app as Parameters<typeof archiveCompany>[1], name);
  return { ...company, ids: await seedReportData(db.database.prisma, company) };
}

/**
 * Datos de los cinco reportes en una empresa con dos puntos: comprobantes de los seis tipos en los
 * dos ambientes, retenciones, inventario con un saldo de 18 dígitos y terceros. Devuelve los
 * identificadores sembrados.
 */
export async function seedReportData(
  prisma: PrismaClient,
  company: FiscalCompany,
): Promise<Record<string, string>> {
  await loadInstalledFiscalCatalogs(prisma);
  const ids: Record<string, string> = {};
  const p0 = company.points[0]!;
  const productId = await insertProduct(prisma, company, { name: "Tornillo", mainCode: "T-1" });
  ids.product = productId;
  const invoice = await insertAuthorizedInvoice(
    prisma,
    {
      companyId: company.companyId,
      adminId: company.adminId,
      establishmentId: p0.establishmentId,
      emissionPointId: p0.emissionPointId,
    },
    [{ productId, quantity: "10", unitPrice: "8.75" }],
    { issueDate: "2026-09-10" },
  );
  ids.invoice = invoice.id;
  const customer = `0${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  ids.customer = customer;
  ids.hostileInvoice = (
    await insertDocument(prisma, company, "AUTHORIZED", {
      documentType: "01",
      issueDate: "2026-09-20",
      buyer: { identification: customer, name: '=HYPERLINK("http://ejemplo.invalid")' },
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
  ids.rejectedInvoice = (
    await insertDocument(prisma, company, "NOT_AUTHORIZED", {
      documentType: "01",
      issueDate: "2026-09-21",
      total: "11.50",
      snapshot: invoiceAmounts("10.00", [{ taxCode: "2", amount: "1.50" }], "11.50"),
    })
  ).id;
  ids.productionInvoice = (
    await insertDocument(prisma, company, "AUTHORIZED", {
      documentType: "01",
      environment: "PRODUCTION",
      point: 1,
      issueDate: "2026-09-22",
      total: "11.50",
      snapshot: invoiceAmounts("10.00", [{ taxCode: "2", amount: "1.50" }], "11.50"),
    })
  ).id;
  ids.debitNote = (
    await insertDebitNote(prisma, company, invoice.id, "AUTHORIZED", {
      total: "11.50",
      snapshot: debitNoteAmounts("10.00", [{ taxCode: "2", amount: "1.50" }], "11.50"),
      issueDate: "2026-09-28",
    })
  ).id;
  const seller = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  ids.settlement = (
    await insertPurchaseSettlement(
      prisma,
      company,
      await insertPurchaseSupplier(prisma, company, seller),
      "AUTHORIZED",
      {
        total: "115.00",
        buyer: { identification: seller, name: "María Quishpe" },
        snapshot: purchaseSettlementAmounts("100.00", "15.00", "115.00"),
        issueDate: "2026-09-05",
      },
    )
  ).id;
  const recipients = [];
  for (const label of ["Uno", "Dos", "Tres"]) {
    const identification = `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    recipients.push({
      identification,
      name: label,
      partyId: await insertGuideParty(prisma, company, identification, { legalName: label }),
    });
  }
  ids.guide = (
    await insertShippingGuide(prisma, company, "AUTHORIZED", {
      issueDate: "2026-09-15",
      recipients: recipients.slice(0, 1),
    })
  ).id;
  ids.guideMany = (
    await insertShippingGuide(prisma, company, "RESERVED", { issueDate: "2026-10-02", recipients })
  ).id;
  ids.creditNote = (
    await insertCreditNote(prisma, company, invoice, {
      lines: [{ position: 1, quantity: "2" }],
      state: "RECEIVED",
      freezeTotals: true,
    })
  ).id;
  const supplierId = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}001`;
  ids.supplier = supplierId;
  const supplier = await insertSupplier(prisma, company, supplierId);
  const subject = { identification: supplierId, name: "Proveedor -1+1" };
  const line = (supportPosition: number, position: number, amount: string, base: string) => ({
    supportPosition,
    position,
    tax: "1" as const,
    taxLabel: "RENTA",
    code: "303",
    base,
    percentage: "10",
    amount,
  });
  ids.withholding = (
    await insertWithholdingReceipt(prisma, company, {
      partyId: supplier,
      state: "AUTHORIZED",
      issueDate: "2026-10-03",
      fiscalPeriod: "09/2026",
      subject,
      total: "13.00",
      lines: [
        line(1, 1, "10.00", "100.00"),
        line(1, 2, "2.00", "20.00"),
        line(2, 1, "1.00", "10.00"),
      ],
    })
  ).id;
  ids.returnedWithholding = (
    await insertWithholdingReceipt(prisma, company, {
      partyId: supplier,
      state: "RETURNED",
      issueDate: "2026-10-01",
      fiscalPeriod: "10/2026",
      subject,
      total: "10.00",
      lines: [line(1, 1, "10.00", "100.00")],
    })
  ).id;
  // Inventario: un saldo de 18 dígitos (texto exacto en el XLSX), una salida y un ajuste.
  const huge = await insertProduct(prisma, company, { name: "Arena a granel", mainCode: "A-1" });
  ids.hugeProduct = huge;
  const write = (work: (stock: ReturnType<typeof createStockRepository>) => Promise<unknown>) =>
    prisma.$transaction((tx) => work(createStockRepository(tx)));
  await write((stock) =>
    stock.initialize({
      companyId: company.companyId,
      productId: huge,
      quantity: "999999999999.999999",
      note: null,
      actorUserId: company.adminId,
      at: new Date("2026-09-01T12:00:00Z"),
    }),
  );
  await write((stock) =>
    stock.initialize({
      companyId: company.companyId,
      productId,
      quantity: "20",
      note: null,
      actorUserId: company.adminId,
      at: new Date("2026-09-01T04:30:00Z"),
    }),
  );
  await write((stock) =>
    stock.append({
      companyId: company.companyId,
      productId,
      type: "SALIDA_FACTURA",
      delta: "-5",
      origin: "SYSTEM",
      actorUserId: null,
      documentId: invoice.id,
      documentNumber: invoice.documentNumber,
      occurredAt: new Date("2026-09-15T15:00:00Z"),
    }),
  );
  await write((stock) =>
    stock.append({
      companyId: company.companyId,
      productId,
      type: "AJUSTE",
      delta: "-0.5",
      origin: "USER",
      actorUserId: company.adminId,
      reason: "Conteo",
      idempotency: {
        operation: "inventory.adjust",
        key: randomUUID(),
        requestHash: "c".repeat(64),
      },
      occurredAt: new Date("2026-10-01T04:59:59.999Z"),
    }),
  );
  ids.party = await insertGuideParty(prisma, company, customer, {
    legalName: '=HYPERLINK("http://ejemplo.invalid")',
    roles: ["CUSTOMER"],
  });
  return ids;
}

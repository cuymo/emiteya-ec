// Arnés de las pruebas de los reportes (add-reports-export): las fuentes compuestas como en main.ts y
// comprobantes de los seis tipos con los importes de su snapshot. Cada fragmento de snapshot se tipa
// con el tipo del módulo dueño, de modo que una ruta que no exista en el snapshot real no compila.
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { DbClient } from "../../src/platform/db/database.ts";
import type { ReportSource } from "../../src/platform/db/report-source.ts";
import { creditNoteReportAmounts } from "../../src/modules/credit-notes/infrastructure/index.ts";
import { debitNoteReportAmounts } from "../../src/modules/debit-notes/infrastructure/index.ts";
import {
  createInvoicesReportSource,
  createIssuedDocumentsReportSource,
} from "../../src/modules/fiscal/infrastructure/index.ts";
import {
  invoiceReportAmounts,
  invoiceReportTaxes,
} from "../../src/modules/invoices/infrastructure/index.ts";
import { purchaseSettlementReportAmounts } from "../../src/modules/purchase-settlements/infrastructure/index.ts";
import { shippingGuideReportAmounts } from "../../src/modules/shipping-guides/infrastructure/index.ts";
import {
  withholdingReportAmounts,
  createWithholdingsReportSource,
} from "../../src/modules/withholding-receipts/infrastructure/index.ts";
import type { CreditNoteSnapshot } from "../../src/modules/credit-notes/domain/snapshot.ts";
import type { DebitNoteSnapshot } from "../../src/modules/debit-notes/domain/snapshot.ts";
import type { InvoiceSnapshot } from "../../src/modules/invoices/domain/snapshot.ts";
import type { PurchaseSettlementSnapshot } from "../../src/modules/purchase-settlements/domain/snapshot.ts";
import type { WithholdingSnapshot } from "../../src/modules/withholding-receipts/domain/snapshot.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument } from "./transmission-harness.ts";

export const REPORT_PROJECTIONS = [
  invoiceReportAmounts,
  purchaseSettlementReportAmounts,
  creditNoteReportAmounts,
  debitNoteReportAmounts,
  shippingGuideReportAmounts,
  withholdingReportAmounts,
];

export function documentSources(schema: string) {
  return {
    issued: createIssuedDocumentsReportSource(schema, REPORT_PROJECTIONS),
    invoices: createInvoicesReportSource(schema, invoiceReportTaxes),
    withholdings: createWithholdingsReportSource(schema),
  };
}

/** Todas las páginas de una fuente, concatenadas en orden. */
export async function allPages<F, R>(
  db: DbClient,
  source: ReportSource<F, R>,
  companyId: string,
  filters: F,
  pageSize = 2,
): Promise<R[]> {
  const rows: R[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await source.page(db, companyId, filters, { offset, limit: pageSize });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/** Todos los lotes del cursor en una transacción `REPEATABLE READ` de solo lectura. */
export function allBatches<F, R>(
  prisma: PrismaClient,
  source: ReportSource<F, R>,
  companyId: string,
  filters: F,
  size = 2,
): Promise<{ rows: R[]; batches: number; count: number }> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
      const count = await source.count(tx, companyId, filters);
      const rows: R[] = [];
      let batches = 0;
      for await (const batch of source.batches(tx, companyId, filters, size)) {
        rows.push(...batch);
        batches += 1;
      }
      return { rows, batches, count };
    },
    { timeout: 60_000 },
  );
}

type Tax = Readonly<{ taxCode: string; amount: string }>;
const taxLines = (base: string, taxes: readonly Tax[]) =>
  taxes.map((tax) => ({ ...tax, rateCode: "4", percentage: "15", base }));

export function invoiceAmounts(
  withoutTaxes: string,
  taxes: readonly Tax[],
  total: string,
): Pick<InvoiceSnapshot, "totals"> {
  return {
    totals: { withoutTaxes, discount: "0.00", taxes: taxLines(withoutTaxes, taxes), total },
  };
}

export function creditNoteAmounts(
  withoutTaxes: string,
  taxes: readonly Tax[],
  total: string,
): Pick<CreditNoteSnapshot, "totals"> {
  return {
    totals: { withoutTaxes, discount: "0.00", taxes: taxLines(withoutTaxes, taxes), total },
  };
}

export function purchaseSettlementAmounts(
  withoutTaxes: string,
  vat: string,
  total: string,
): Pick<PurchaseSettlementSnapshot, "totals"> {
  return {
    totals: {
      withoutTaxes,
      discount: "0.00",
      taxes: [{ taxCode: "2", rateCode: "4", percentage: "15", base: withoutTaxes, amount: vat }],
      total,
    },
  };
}

export function debitNoteAmounts(
  withoutTaxes: string,
  taxes: readonly Tax[],
  total: string,
): Pick<DebitNoteSnapshot, "taxes" | "totals"> {
  return { taxes: taxLines(withoutTaxes, taxes), totals: { withoutTaxes, total } };
}

type WithholdingLine = Readonly<{
  supportPosition: number;
  position: number;
  tax: "1" | "2";
  taxLabel: string;
  code: string;
  base: string;
  percentage: string;
  amount: string;
}>;

/** Los sustentos del snapshot con la denominación congelada de cada retención. */
type SupportsFragment = {
  supports: (Pick<WithholdingSnapshot["supports"][number], "position"> & {
    withholdings: Pick<
      WithholdingSnapshot["supports"][number]["withholdings"][number],
      "position" | "taxLabel"
    >[];
  })[];
};

/** Un comprobante de retención con su registro, sus líneas y la denominación de cada impuesto. */
export function insertWithholdingReceipt(
  prisma: PrismaClient,
  company: FiscalCompany,
  options: {
    partyId: string;
    state: string;
    environment?: "TEST" | "PRODUCTION";
    issueDate?: string;
    fiscalPeriod: string;
    subject: { identification: string; name: string };
    lines: readonly WithholdingLine[];
    total: string;
  },
) {
  const positions = [...new Set(options.lines.map((line) => line.supportPosition))];
  const supports: SupportsFragment = {
    supports: positions.map((position) => ({
      position,
      withholdings: options.lines
        .filter((line) => line.supportPosition === position)
        .map((line) => ({ position: line.position, taxLabel: line.taxLabel })),
    })),
  };
  return insertDocument(prisma, company, options.state, {
    documentType: "07",
    environment: options.environment ?? "TEST",
    issueDate: options.issueDate ?? "2026-10-04",
    buyer: options.subject,
    total: options.total,
    snapshot: supports,
    alongside: async (tx, document) => {
      await tx.withholdingReceipt.create({
        data: {
          companyId: company.companyId,
          documentId: document.id,
          partyId: options.partyId,
          relatedParty: "NO",
          fiscalPeriod: options.fiscalPeriod,
        },
      });
      await tx.withholdingReceiptLine.createMany({
        data: options.lines.map((line) => ({
          companyId: company.companyId,
          documentId: document.id,
          supportPosition: line.supportPosition,
          position: line.position,
          supportDocumentType: "01",
          supportCode: "01",
          supportNumber: `001001${String(line.supportPosition).padStart(9, "0")}`,
          supportIssueDate: new Date("2026-09-15"),
          tax: line.tax,
          withholdingCode: line.code,
          entryKey: `${line.tax}-${line.code}`,
          base: line.base,
          percentage: line.percentage,
          amount: line.amount,
        })),
      });
    },
  });
}

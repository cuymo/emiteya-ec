// Arnés de las pruebas de las notas de crédito (add-credit-notes): facturas autorizadas con un
// snapshot de la versión 2 calculado con la aritmética real de la factura, su clave compuesta, su
// XML firmado y su XML autorizado, escritas directamente en las tablas; y la alteración de un
// snapshot para simular una corrupción que la integridad debe detectar.
import { createHash } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import { invoiceTotals, lineAmounts } from "../../src/modules/invoices/domain/amounts.ts";
import type { InvoiceSnapshot } from "../../src/modules/invoices/domain/snapshot.ts";
import { compareDecimalStrings } from "@facturador/contracts";
import { calculateCreditNoteAmounts } from "../../src/modules/credit-notes/domain/amounts.ts";
import { createCreditCapacityRepository } from "../../src/modules/credit-notes/infrastructure/prisma-credit-capacity.ts";
import {
  createStockRepository,
  stockReturnCapacity,
} from "../../src/modules/inventory/infrastructure/index.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";
import { createAccessKeys } from "../../src/modules/sri-engine/infrastructure/access-keys.ts";
import { signedXmlOf } from "./transmission-harness.ts";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const accessKeys = createAccessKeys();

export type InvoiceCompany = Readonly<{
  companyId: string;
  adminId: string;
  establishmentId: string;
  emissionPointId: string;
}>;

export const IVA15 = { taxCode: "2", rateCode: "4", percentage: "15" } as const;
export const IVA0 = { taxCode: "2", rateCode: "0", percentage: "0" } as const;

export type InvoiceLineSpec = Readonly<{
  productId: string;
  quantity: string;
  unitPrice: string;
  discount?: string;
  rate?: Readonly<{ taxCode: string; rateCode: string; percentage: string }>;
  inventoryAffectsStock?: boolean;
  description?: string;
  mainCode?: string | null;
}>;

export type AuthorizedInvoiceDocument = Readonly<{
  id: string;
  documentNumber: string;
  accessKey: string;
  total: string;
  snapshot: InvoiceSnapshot;
}>;

/** Snapshot de la versión 2 de una factura con las líneas dadas, sin la clave. */
export function invoiceSnapshot(
  lines: readonly InvoiceLineSpec[],
  options: { consumerFinal?: boolean; issueDate?: string } = {},
): Omit<InvoiceSnapshot, "key"> {
  const computed = lines.map((line) => {
    const rate = line.rate ?? IVA15;
    return {
      line,
      rate,
      amounts: lineAmounts({
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount ?? "0",
        taxes: [rate],
      }),
    };
  });
  const totals = invoiceTotals(computed.map((c) => c.amounts));
  const consumerFinal = options.consumerFinal ?? false;
  return {
    snapshotVersion: 2,
    schema: {
      documentType: "01",
      version: "1.1.0",
      path: "sri-xsd/factura_V1.1.0.xsd",
      sha256: "a".repeat(64),
      imports: [],
    },
    builderVersion: "1",
    catalogDatasets: {},
    taxpayerConfig: { versionId: "config", version: 1 },
    issueDate: options.issueDate ?? "2026-10-01",
    environment: "TEST",
    environmentCode: "1",
    issuer: {
      ruc: "1790012345001",
      legalName: "COMERCIAL ANDINA S.A.",
      tradeName: null,
      headOfficeAddress: "Av. Amazonas N24-03, Quito",
      establishment: { id: "e", code: "001", address: "Av. 6 de Diciembre, Quito" },
      emissionPoint: { id: "p", code: "001" },
      accountingRequired: true,
      specialTaxpayerNumber: null,
      withholdingAgentResolution: null,
      rimpeCategory: null,
      largeTaxpayer: false,
    },
    buyer: consumerFinal
      ? {
          partyId: "consumidor-final",
          identificationType: "07",
          identification: "9999999999999",
          legalName: "CONSUMIDOR FINAL",
          address: null,
          consumerFinal: true,
          consumerFinalPolicy: { versionId: "politica", maxAmount: "50.00", allowed: true },
        }
      : {
          partyId: "cliente",
          identificationType: "04",
          identification: "0992877878001",
          legalName: "EL PERNO CIA. LTDA.",
          address: "Av. Quito y Guayaquil",
          consumerFinal: false,
          consumerFinalPolicy: null,
        },
    lines: computed.map(({ line, rate, amounts }, index) => ({
      position: index + 1,
      productId: line.productId,
      mainCode: line.mainCode === undefined ? `COD-${index + 1}` : line.mainCode,
      auxiliaryCode: null,
      description: line.description ?? `Producto ${index + 1}`,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discount: amounts.discount,
      subtotal: amounts.subtotal,
      taxableBase: amounts.taxableBase,
      taxes: amounts.taxes.map((tax) => ({
        taxCode: tax.taxCode,
        rateCode: tax.rateCode,
        catalogType: "iva-rate",
        entryKey: rate.rateCode,
        versionId: `${rate.rateCode}@1`,
        officialLabel: `IVA ${rate.percentage} %`,
        percentage: tax.percentage,
        base: tax.base,
        amount: tax.amount,
      })),
      inventoryAffectsStock: line.inventoryAffectsStock ?? false,
    })),
    totals: {
      withoutTaxes: totals.withoutTaxes,
      discount: totals.discount,
      taxes: totals.taxes.map(({ taxCode, rateCode, percentage, base, amount }) => ({
        taxCode,
        rateCode,
        percentage,
        base,
        amount,
      })),
      total: totals.total,
    },
    payments: [
      {
        position: 1,
        entryKey: "01",
        code: "01",
        versionId: "01@1",
        officialLabel: "Efectivo",
        amount: totals.total,
      },
    ],
    specialCases: { operation: [], issuerRules: [] },
  };
}

/**
 * Factura en `state` (`AUTHORIZED` por defecto) con su número real del punto, su clave compuesta,
 * su `SIGNED_XML` y, autorizada, su `AUTHORIZED_XML` con los mismos bytes.
 */
export async function insertAuthorizedInvoice(
  prisma: PrismaClient,
  company: InvoiceCompany,
  lines: readonly InvoiceLineSpec[],
  options: { consumerFinal?: boolean; state?: string; issueDate?: string } = {},
): Promise<AuthorizedInvoiceDocument> {
  const state = options.state ?? "AUTHORIZED";
  const issueDate = options.issueDate ?? "2026-10-01";
  const reservation = await createSequentialReservation(createFiscalUnitOfWork(prisma)).reserve({
    companyId: company.companyId,
    environment: "TEST",
    establishmentId: company.establishmentId,
    emissionPointId: company.emissionPointId,
    documentType: "01",
    reservedBy: company.adminId,
    correlationId: "prueba-nota-credito",
  });
  const sequential = String(reservation.sequential).padStart(9, "0");
  const numericCode = accessKeys.numericCode();
  const accessKey = accessKeys.compose({
    issueDate,
    documentType: "01",
    ruc: "1790012345001",
    environment: "1",
    establishment: "001",
    emissionPoint: "001",
    sequential,
    numericCode,
  });
  const draft = invoiceSnapshot(lines, { ...options, issueDate });
  const snapshot: InvoiceSnapshot = {
    ...draft,
    key: {
      documentNumber: reservation.documentNumber,
      sequential,
      numericCode,
      emissionType: "1",
      accessKey,
    },
  };
  const xml = signedXmlOf(accessKey);
  return prisma.$transaction(async (tx) => {
    const document = await tx.electronicDocument.create({
      data: {
        companyId: company.companyId,
        documentType: "01",
        environment: "TEST",
        establishmentId: company.establishmentId,
        emissionPointId: company.emissionPointId,
        documentNumber: reservation.documentNumber,
        sequential: reservation.sequential,
        reservationId: reservation.reservationId,
        accessKey,
        numericCode,
        issueDate: new Date(issueDate),
        state,
        snapshot,
        schemaVersion: "1.1.0",
        buyerIdentification: snapshot.buyer.identification,
        buyerName: snapshot.buyer.legalName,
        total: snapshot.totals.total,
        createdBy: company.adminId,
        signedAt: state === "RESERVED" ? null : new Date(`${issueDate}T14:00:00Z`),
        ...(state === "AUTHORIZED"
          ? {
              authorizationNumber: accessKey,
              authorizationDate: new Date(`${issueDate}T15:00:00Z`),
              authorizationEnvironment: "TEST",
            }
          : {}),
      },
    });
    const kinds = state === "RESERVED" ? [] : ["SIGNED_XML"];
    if (state === "AUTHORIZED") kinds.push("AUTHORIZED_XML");
    for (const kind of kinds) {
      await tx.documentArtifact.create({
        data: {
          companyId: company.companyId,
          documentId: document.id,
          kind,
          mediaType: "application/xml",
          content: new Uint8Array(xml),
          sizeBytes: xml.length,
          sha256: sha256(xml),
          metadata: { documentType: "01", schemaVersion: "1.1.0" },
        },
      });
    }
    return {
      id: document.id,
      documentNumber: reservation.documentNumber,
      accessKey,
      total: snapshot.totals.total,
      snapshot,
    };
  });
}

/**
 * Cambia el snapshot de un comprobante saltando su trigger solo en el esquema de la prueba: simula
 * una corrupción que la integridad debe detectar.
 */
export async function tamperSnapshot(
  prisma: PrismaClient,
  schema: string,
  documentId: string,
  change: (snapshot: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const table = `"${schema}"."electronic_document"`;
  const { snapshot } = await prisma.electronicDocument.findUniqueOrThrow({
    where: { id: documentId },
    select: { snapshot: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER electronic_document_guard`);
    await tx.$executeRawUnsafe(
      `UPDATE ${table} SET snapshot = $1::jsonb WHERE id = $2`,
      JSON.stringify(change(snapshot as Record<string, unknown>)),
      documentId,
    );
    // Los triggers diferidos pendientes se evalúan ya: con eventos pendientes no se altera la tabla.
    await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER electronic_document_guard`);
  });
}

/**
 * La salida de inventario de una factura para un producto, como la registra el seguidor de su
 * autorización: inicializa el inventario del producto si falta (en su propia transacción) y agrega
 * la `SALIDA_FACTURA`.
 */
export async function recordOutflow(
  prisma: PrismaClient,
  company: Pick<InvoiceCompany, "companyId" | "adminId">,
  invoice: Pick<AuthorizedInvoiceDocument, "id" | "documentNumber">,
  productId: string,
  quantity: string,
  initial = "100",
): Promise<void> {
  const exists = await prisma.stockBalance.findUnique({
    where: { companyId_productId: { companyId: company.companyId, productId } },
  });
  if (!exists) {
    await prisma.$transaction((tx) =>
      createStockRepository(tx).initialize({
        companyId: company.companyId,
        productId,
        quantity: initial,
        note: null,
        actorUserId: company.adminId,
        at: new Date(),
      }),
    );
  }
  await prisma.$transaction((tx) =>
    createStockRepository(tx).append({
      companyId: company.companyId,
      productId,
      type: "SALIDA_FACTURA",
      delta: `-${quantity}`,
      origin: "SYSTEM",
      actorUserId: null,
      documentId: invoice.id,
      documentNumber: invoice.documentNumber,
      occurredAt: new Date(),
    }),
  );
}

/**
 * Nota de crédito en `state` sobre una factura, con sus reservas acreditable y devolvible escritas
 * en la misma transacción por los repositorios reales y con los importes del cálculo único. Su
 * snapshot es el mínimo que la transmisión necesita (la clave) y su XML firmado, el sintético.
 */
export async function insertCreditNote(
  prisma: PrismaClient,
  company: FiscalCompany,
  invoice: AuthorizedInvoiceDocument,
  input: {
    lines: readonly { position: number; quantity: string; physicalReturn?: string }[];
    state?: string;
    cause?: "RETURN" | "TOTAL_ANNULMENT";
  },
): Promise<TestDocument> {
  // Los importes del cálculo único con lo acreditado vigente (las pruebas reservan en serie).
  const state = await createCreditCapacityRepository(prisma).read(company.companyId, invoice.id);
  const amounts = calculateCreditNoteAmounts({
    invoiceLines: invoice.snapshot.lines.map((line) => ({
      position: line.position,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      subtotal: line.subtotal,
      discount: line.discount,
      taxableBase: line.taxableBase,
      taxes: line.taxes,
    })),
    credited: state.credited,
    requested: input.lines.map(({ position, quantity }) => ({ position, quantity })),
    invoice: { total: invoice.total, reserved: state.reserved, applied: state.applied },
  });
  const totals = amounts.totals;
  if (!totals) throw new Error(`nota inválida: ${JSON.stringify(amounts.issues)}`);
  const products = new Map(invoice.snapshot.lines.map((line) => [line.position, line.productId]));
  const returns = input.lines
    .filter((line) => line.physicalReturn && compareDecimalStrings(line.physicalReturn, "0") > 0)
    .map((line) => ({ productId: products.get(line.position)!, quantity: line.physicalReturn! }));
  return insertDocument(prisma, company, input.state ?? "RECEIVED", {
    documentType: "04",
    total: totals.total,
    alongside: async (tx, document) => {
      const capacity = createCreditCapacityRepository(tx);
      await capacity.lock(company.companyId, invoice.id);
      await capacity.initialize({
        companyId: company.companyId,
        invoiceId: invoice.id,
        total: invoice.total,
        lines: invoice.snapshot.lines.map(({ position, productId, quantity }) => ({
          position,
          productId,
          quantity,
        })),
      });
      await capacity.reserve({
        companyId: company.companyId,
        invoiceId: invoice.id,
        amount: totals.total,
        lines: amounts.lines.map(({ position, quantity }) => ({ position, quantity })),
      });
      await stockReturnCapacity(tx).reserve({
        companyId: company.companyId,
        invoiceId: invoice.id,
        returns,
      });
      await capacity.record({
        companyId: company.companyId,
        invoiceId: invoice.id,
        creditNoteId: document.id,
        cause: input.cause ?? "RETURN",
        amount: totals.total,
        lines: amounts.lines.map((line) => ({
          position: line.position,
          quantity: line.quantity,
          subtotal: line.subtotal,
          discount: line.discount,
          taxableBase: line.taxableBase,
          taxes: line.taxes,
          physicalReturn:
            input.lines.find((l) => l.position === line.position)?.physicalReturn ?? "0",
        })),
      });
      await stockReturnCapacity(tx).record({
        companyId: company.companyId,
        invoiceId: invoice.id,
        creditNoteId: document.id,
        returns,
      });
    },
  });
}

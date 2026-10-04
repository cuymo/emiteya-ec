// Arnés de las pruebas del archivo documental (add-document-archive): comprobantes autorizados con
// la clave, el XML firmado y el XML autorizado de una factura real (builder, XSD y firma), escritos
// directamente en las tablas, y la alteración de un artefacto para simular su corrupción.
import { createHash } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import {
  INVOICE_CASES,
  PAYMENT_LABELS,
  authorizedAtOf,
  authorizedInvoice,
  type AuthorizedInvoice,
  type InvoiceCase,
} from "../support/ride-invoices.ts";
import { key, reservationInput, type FiscalCompany } from "./fiscal-harness.ts";

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

let sequence = 100;
/** Una factura real con un secuencial nuevo: su clave no choca con la de otro comprobante. */
export function nextInvoice(
  p12Dir: string,
  base: InvoiceCase = INVOICE_CASES.oneLine,
  overrides: Partial<InvoiceCase> = {},
): Promise<AuthorizedInvoice> {
  sequence++;
  return authorizedInvoice(
    {
      ...base,
      ...overrides,
      name: `${base.name}-${sequence}`,
      sequential: String(sequence).padStart(9, "0"),
    },
    p12Dir,
  );
}

export type ArchiveDocument = Readonly<{
  id: string;
  companyId: string;
  accessKey: string;
  invoice: AuthorizedInvoice;
}>;

/**
 * Comprobante `AUTHORIZED` (o en `state`) con el `SIGNED_XML` de la factura y, si se pide, su
 * `AUTHORIZED_XML` (el SRI lo devuelve con los mismos bytes). El snapshot trae lo que el RIDE lee:
 * la denominación de los pagos y la versión de la configuración.
 */
export async function insertArchiveDocument(
  prisma: PrismaClient,
  company: FiscalCompany,
  invoice: AuthorizedInvoice,
  options: {
    state?: string;
    authorizedXml?: boolean;
    configVersionId?: string | null;
    paymentLabels?: Readonly<Record<string, string>>;
    environment?: "TEST" | "PRODUCTION";
    issueDate?: string;
  } = {},
): Promise<ArchiveDocument> {
  const state = options.state ?? "AUTHORIZED";
  const environment =
    options.environment ?? (invoice.snapshot.environment === "1" ? "TEST" : "PRODUCTION");
  const reservation = await createSequentialReservation(createFiscalUnitOfWork(prisma)).reserve(
    reservationInput(key(company)),
  );
  const labels = options.paymentLabels ?? PAYMENT_LABELS;
  const { accessKey } = invoice.snapshot;
  return prisma.$transaction(async (tx) => {
    const document = await tx.electronicDocument.create({
      data: {
        companyId: company.companyId,
        documentType: "01",
        environment,
        establishmentId: company.points[0]!.establishmentId,
        emissionPointId: company.points[0]!.emissionPointId,
        documentNumber: `001-001-${String(reservation.sequential).padStart(9, "0")}`,
        sequential: reservation.sequential,
        reservationId: reservation.reservationId,
        accessKey,
        numericCode: accessKey.slice(39, 47),
        issueDate: new Date(options.issueDate ?? invoice.snapshot.issueDate),
        state,
        snapshot: {
          snapshotVersion: 1,
          taxpayerConfig: options.configVersionId
            ? { versionId: options.configVersionId, version: 1 }
            : null,
          payments: invoice.snapshot.payments.map((payment, index) => ({
            position: index + 1,
            entryKey: payment.method,
            code: payment.method,
            versionId: "version-de-catalogo",
            officialLabel: labels[payment.method] ?? "",
            amount: payment.total,
          })),
        },
        schemaVersion: "1.1.0",
        buyerIdentification: invoice.snapshot.buyer.identification,
        buyerName: invoice.snapshot.buyer.legalName,
        total: invoice.snapshot.totals.total,
        createdBy: company.adminId,
        signedAt:
          state === "RESERVED" ? null : new Date(authorizedAtOf(invoice.snapshot.issueDate)),
        ...(state === "AUTHORIZED"
          ? {
              authorizationNumber: accessKey,
              authorizationDate: authorizedAtOf(invoice.snapshot.issueDate),
              authorizationEnvironment: environment,
            }
          : {}),
      },
    });
    const kinds = state === "RESERVED" ? [] : ["SIGNED_XML"];
    if (state === "AUTHORIZED" && options.authorizedXml !== false) kinds.push("AUTHORIZED_XML");
    for (const kind of kinds) {
      await tx.documentArtifact.create({
        data: {
          companyId: company.companyId,
          documentId: document.id,
          kind,
          mediaType: "application/xml",
          content: new Uint8Array(invoice.xml),
          sizeBytes: invoice.xml.length,
          sha256: sha256(invoice.xml),
          metadata: {},
        },
      });
    }
    return { id: document.id, companyId: company.companyId, accessKey, invoice };
  });
}

/**
 * Altera un byte de un artefacto guardado, saltando el trigger de solo agregado solo en el esquema
 * de la prueba: simula una corrupción que la integridad debe detectar.
 */
export async function corruptArtifact(
  prisma: PrismaClient,
  schema: string,
  documentId: string,
  kind: string,
): Promise<void> {
  const table = `"${schema}"."document_artifact"`;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `ALTER TABLE ${table} DISABLE TRIGGER document_artifact_append_only`,
    );
    await tx.$executeRawUnsafe(
      `UPDATE ${table} SET content = set_byte(content, 10, get_byte(content, 10) # 1)
       WHERE document_id = $1 AND kind = $2`,
      documentId,
      kind,
    );
    await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER document_artifact_append_only`);
  });
}

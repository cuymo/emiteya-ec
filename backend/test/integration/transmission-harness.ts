// Arnés de las pruebas de la transmisión (add-sri-transmission): comprobantes en cualquier estado,
// escritos directamente en las tablas con su XML firmado, y jobs arrendados con el repositorio real.
import { createHash, randomInt } from "node:crypto";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import type { Prisma, PrismaClient } from "../../src/generated/prisma/client.ts";
import type { Job, JobStore, NewJob } from "../../src/platform/jobs/jobs.ts";
import { key, reservationInput, type FiscalCompany } from "./fiscal-harness.ts";

export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const randomAccessKey = () => Array.from({ length: 49 }, () => randomInt(10)).join("");

/** XML firmado sintético: contiene la clave exactamente una vez, como el real. */
export const signedXmlOf = (accessKey: string) =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<factura id="comprobante" version="1.1.0"><infoTributaria><ambiente>1</ambiente><claveAcceso>${accessKey}</claveAcceso><razonSocial>Peña &amp; Cía</razonSocial></infoTributaria><ds:Signature>firma sintética</ds:Signature></factura>`,
    "utf8",
  );

export type TestDocument = Awaited<ReturnType<typeof insertDocument>>;

/** Comprobante en `state`, con su `SIGNED_XML` si ya está firmado y su autorización si la tiene. */
export async function insertDocument(
  prisma: PrismaClient,
  company: FiscalCompany,
  state: string,
  options: {
    environment?: "TEST" | "PRODUCTION";
    signedXml?: (accessKey: string) => Buffer;
    /** Para la bandeja: fecha de emisión, receptor y punto (por defecto el primero). */
    issueDate?: string;
    buyer?: { identification: string; name: string };
    point?: number;
    /** Para el inventario: campos del snapshot, por ejemplo la versión 2 con sus líneas. */
    snapshot?: Record<string, unknown>;
    /**
     * Para las notas, las retenciones y las liquidaciones (add-credit-notes, add-debit-notes,
     * add-withholding-receipts, add-purchase-settlements): el tipo, el total y, en `alongside`, las
     * reservas de una nota de crédito, la factura de una nota de débito, el registro y las líneas de
     * un comprobante de retención o el registro y las declaraciones de una liquidación de compra.
     */
    documentType?: "01" | "03" | "04" | "05" | "06" | "07";
    total?: string;
    /**
     * Destinatarios de una guía de remisión (add-shipping-guides, design D10): el tipo 06 no tiene
     * total ni comprador, y sus destinatarios se escriben en la misma transacción.
     */
    recipients?: readonly { identification: string; name: string }[];
    /** Escrituras en la misma transacción que el comprobante, como las reservas de una nota. */
    alongside?: (tx: Prisma.TransactionClient, document: { id: string }) => Promise<void>;
  } = {},
) {
  const documentType = options.documentType ?? "01";
  const reservation = await createSequentialReservation(createFiscalUnitOfWork(prisma)).reserve(
    reservationInput(key(company, options.point ?? 0, documentType)),
  );
  const point = company.points[options.point ?? 0]!;
  const accessKey = randomAccessKey();
  const environment = options.environment ?? "TEST";
  return prisma.$transaction(async (tx) => {
    const document = await tx.electronicDocument.create({
      data: {
        companyId: company.companyId,
        documentType,
        environment,
        establishmentId: point.establishmentId,
        emissionPointId: point.emissionPointId,
        documentNumber: `${point.code}-001-${String(reservation.sequential).padStart(9, "0")}`,
        sequential: reservation.sequential,
        reservationId: reservation.reservationId,
        accessKey,
        numericCode: "12345678",
        issueDate: new Date(options.issueDate ?? "2026-10-04"),
        state,
        snapshot: { snapshotVersion: 1, key: { accessKey }, ...options.snapshot },
        schemaVersion: "1.1.0",
        ...(documentType === "06"
          ? { buyerIdentification: null, buyerName: null, total: null }
          : {
              buyerIdentification: options.buyer?.identification ?? "9999999999999",
              buyerName: options.buyer?.name ?? "CONSUMIDOR FINAL",
              total: options.total ?? "11.50",
            }),
        createdBy: company.adminId,
        signedAt: state === "RESERVED" ? null : new Date("2026-10-04T14:00:00Z"),
        ...(state === "AUTHORIZED"
          ? {
              authorizationNumber: accessKey,
              authorizationDate: new Date("2026-10-04T15:00:00Z"),
              authorizationEnvironment: environment,
            }
          : {}),
      },
    });
    if (state !== "RESERVED") {
      const content = (options.signedXml ?? signedXmlOf)(accessKey);
      await tx.documentArtifact.create({
        data: {
          companyId: company.companyId,
          documentId: document.id,
          kind: "SIGNED_XML",
          mediaType: "application/xml",
          content: new Uint8Array(content),
          sizeBytes: content.length,
          sha256: sha256(content),
          metadata: { documentType, schemaVersion: "1.1.0" },
        },
      });
    }
    if (documentType === "06") {
      const recipients = options.recipients ?? [
        { identification: "1790012345001", name: "Comercial Andina S.A." },
      ];
      await tx.electronicDocumentRecipient.createMany({
        data: recipients.map((recipient, index) => ({
          companyId: company.companyId,
          documentId: document.id,
          position: index + 1,
          ...recipient,
        })),
      });
    }
    await options.alongside?.(tx, document);
    return document;
  });
}

/**
 * Encola un job con el repositorio real y lo arrienda directamente, como lo haría `claim`, para que
 * la prueba trabaje con ese job y no con otro pendiente de la cola.
 */
export async function leasedJob(
  store: JobStore,
  prisma: PrismaClient,
  job: NewJob,
  owner = "worker-de-prueba",
): Promise<Job> {
  if (!(await store.enqueueIn(prisma, job))) throw new Error("ya había un job activo");
  const row = await prisma.job.update({
    where: { activeDedupeKey: job.dedupeKey },
    data: {
      status: "LEASED",
      leaseOwner: owner,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      attemptCount: { increment: 1 },
    },
  });
  return row as unknown as Job;
}

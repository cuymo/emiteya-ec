// Arnés de las pruebas de la transmisión (add-sri-transmission): comprobantes en cualquier estado,
// escritos directamente en las tablas con su XML firmado, y jobs arrendados con el repositorio real.
import { createHash, randomInt } from "node:crypto";
import { createSequentialReservation } from "../../src/modules/fiscal/application/reservation.ts";
import { createFiscalUnitOfWork } from "../../src/modules/fiscal/infrastructure/unit-of-work.ts";
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
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
  } = {},
) {
  const reservation = await createSequentialReservation(createFiscalUnitOfWork(prisma)).reserve(
    reservationInput(key(company, options.point ?? 0)),
  );
  const point = company.points[options.point ?? 0]!;
  const accessKey = randomAccessKey();
  const environment = options.environment ?? "TEST";
  return prisma.$transaction(async (tx) => {
    const document = await tx.electronicDocument.create({
      data: {
        companyId: company.companyId,
        documentType: "01",
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
        snapshot: { snapshotVersion: 1, key: { accessKey } },
        schemaVersion: "1.1.0",
        buyerIdentification: options.buyer?.identification ?? "9999999999999",
        buyerName: options.buyer?.name ?? "CONSUMIDOR FINAL",
        total: "11.50",
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
          metadata: { documentType: "01", schemaVersion: "1.1.0" },
        },
      });
    }
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

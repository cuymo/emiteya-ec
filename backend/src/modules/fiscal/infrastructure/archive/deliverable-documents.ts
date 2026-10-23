// Fuente de los comprobantes para su correo (add-email-delivery, design D1 y D4): `fiscal` la
// exporta y el arranque la pasa al módulo de correo, que no lee las tablas de los comprobantes. Da
// lo que el correo resume y sus dos archivos: el XML autorizado, o el firmado transmitido si el SRI
// autorizó sin devolverlo (la misma procedencia que el RIDE), y el RIDE.
import type { DbClient } from "../../../../platform/db/database.ts";
import { createArtifactStore } from "../prisma-artifacts.ts";
import { createDocumentRepository } from "../prisma-documents.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const issuerNameOf = (snapshot: unknown): string => {
  const issuer = isRecord(snapshot) ? snapshot.issuer : null;
  return isRecord(issuer) && typeof issuer.legalName === "string" ? issuer.legalName : "";
};

const invoiceIdOf = (snapshot: unknown): string | null => {
  const invoice = isRecord(snapshot) ? snapshot.invoice : null;
  return isRecord(invoice) && typeof invoice.id === "string" ? invoice.id : null;
};

export function createDeliverableDocumentSource(db: DbClient) {
  const documents = createDocumentRepository(db);
  const artifacts = createArtifactStore(db);
  const bytes = (artifact: Awaited<ReturnType<typeof artifacts.read>>) =>
    artifact
      ? { content: artifact.content, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256 }
      : null;
  return {
    async find(companyId: string, documentId: string) {
      const document = await documents.find(companyId, documentId);
      if (!document) return null;
      const noteOfInvoice = document.documentType === "04" || document.documentType === "05";
      const invoiceId = noteOfInvoice ? invoiceIdOf(document.snapshot) : null;
      const invoice = invoiceId ? await documents.find(companyId, invoiceId) : null;
      return {
        id: document.id,
        companyId: document.companyId,
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        issueDate: document.issueDate,
        accessKey: document.accessKey,
        state: document.state,
        environment: document.authorization?.environment ?? document.environment,
        authorization: document.authorization
          ? {
              number: document.authorization.number,
              environment: document.authorization.environment,
            }
          : null,
        issuerName: issuerNameOf(document.snapshot),
        receiverName: document.buyerName,
        total: document.total,
        snapshot: document.snapshot,
        invoiceSnapshot: invoice?.snapshot ?? null,
      };
    },

    async attachments(companyId: string, documentId: string) {
      const authorized = await artifacts.read(companyId, documentId, "AUTHORIZED_XML");
      const xml = authorized ?? (await artifacts.read(companyId, documentId, "SIGNED_XML"));
      const ride = await artifacts.read(companyId, documentId, "RIDE_PDF");
      return { xml: bytes(xml), ride: bytes(ride) };
    },
  };
}

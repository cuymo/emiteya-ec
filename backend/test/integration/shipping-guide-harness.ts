// Arnés de las pruebas de las guías de remisión (add-shipping-guides): una guía 06 en cualquier estado
// con sus destinatarios en la cabecera común, su registro y sus destinatarios con su sustento, escritos
// en la misma transacción (la base los exige al confirmar), y el XML firmado sintético del arnés de la
// transmisión. Su snapshot es el mínimo que la transmisión necesita: la clave.
import type { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { FiscalCompany } from "./fiscal-harness.ts";
import { insertDocument, type TestDocument } from "./transmission-harness.ts";

/** Tercero activo para una guía: destinatario sin roles, o transportista con `CARRIER`. */
export async function insertGuideParty(
  prisma: PrismaClient,
  company: FiscalCompany,
  identification = "1790012345001",
  options: { roles?: string[]; identificationType?: string; legalName?: string } = {},
): Promise<string> {
  const legalName = options.legalName ?? `Tercero ${identification}`;
  const party = await prisma.party.create({
    data: {
      companyId: company.companyId,
      identificationType:
        options.identificationType ?? (identification.length === 13 ? "04" : "05"),
      identification,
      legalName,
      roles: options.roles ?? [],
      searchName: legalName.toLowerCase(),
      searchIdentification: identification,
      createdBy: company.adminId,
      updatedBy: company.adminId,
    },
  });
  return party.id;
}

/** Un destinatario tercero con una identificación propia, en consignación. */
async function defaultRecipient(
  prisma: PrismaClient,
  company: FiscalCompany,
): Promise<GuideRecipientRow[]> {
  const identification = `17${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}001`;
  const partyId = await insertGuideParty(prisma, company, identification);
  return [{ identification, name: `Tercero ${identification}`, partyId }];
}

export type GuideRecipientRow = {
  identification: string;
  name: string;
  /** Un tercero, o la propia empresa con su establecimiento de destino. */
  partyId?: string;
  destinationEstablishmentId?: string;
  /** La factura sustento, o el caso de la excepción declarada (por defecto, consignación). */
  invoiceId?: string;
  exceptionCase?: string;
  detailCount?: number;
};

export async function insertShippingGuide(
  prisma: PrismaClient,
  company: FiscalCompany,
  state: string,
  options: {
    recipients?: readonly GuideRecipientRow[];
    originEstablishmentId?: string | null;
    environment?: "TEST" | "PRODUCTION";
    issueDate?: string;
    transportStart?: string;
    point?: number;
  } = {},
): Promise<TestDocument> {
  const recipients = options.recipients ?? (await defaultRecipient(prisma, company));
  const issueDate = options.issueDate ?? "2026-10-04";
  return insertDocument(prisma, company, state, {
    documentType: "06",
    issueDate,
    ...(options.environment ? { environment: options.environment } : {}),
    ...(options.point !== undefined ? { point: options.point } : {}),
    recipients: recipients.map(({ identification, name }) => ({ identification, name })),
    alongside: async (tx, document) => {
      const details = recipients.map((recipient) => recipient.detailCount ?? 1);
      await tx.shippingGuide.create({
        data: {
          companyId: company.companyId,
          documentId: document.id,
          originEstablishmentId: options.originEstablishmentId ?? null,
          transporterSource: "SELF",
          carrierIdentificationType: "04",
          carrierIdentification: "1790012345001",
          carrierName: "Empresa emisora",
          plate: "PAA-1234",
          transportStart: new Date(options.transportStart ?? issueDate),
          transportEnd: new Date(options.transportStart ?? issueDate),
          recipientCount: recipients.length,
          detailCount: details.reduce((sum, count) => sum + count, 0),
        },
      });
      for (const [index, recipient] of recipients.entries()) {
        const exceptionCase = recipient.invoiceId
          ? null
          : (recipient.exceptionCase ??
            (recipient.destinationEstablishmentId ? "OWN_ESTABLISHMENT_TRANSFER" : "CONSIGNMENT"));
        await tx.shippingGuideRecipient.create({
          data: {
            companyId: company.companyId,
            documentId: document.id,
            position: index + 1,
            recipientKind: recipient.destinationEstablishmentId ? "OWN_COMPANY" : "PARTY",
            partyId: recipient.partyId ?? null,
            destinationEstablishmentId: recipient.destinationEstablishmentId ?? null,
            supportKind: recipient.invoiceId ? "INTERNAL_INVOICE" : "DECLARED_EXCEPTION",
            invoiceId: recipient.invoiceId ?? null,
            exceptionCase,
            exceptionPolicyVersion: exceptionCase ? 1 : null,
            declaredBy: exceptionCase ? company.adminId : null,
            declaredAt: exceptionCase ? new Date("2026-10-04T14:00:00Z") : null,
            detailCount: details[index]!,
          },
        });
      }
    },
  });
}

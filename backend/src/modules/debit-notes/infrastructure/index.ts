// Composición del módulo debit-notes para main.ts y las pruebas (add-debit-notes, design D1). La
// factura de origen (`invoices`) y la firma de comprobantes (`signing`) llegan como puertos: ninguno
// de esos módulos importa `debit-notes`. La nota de débito no compone capacidades ni inventario.
import type { PrismaClient } from "../../../generated/prisma/client.ts";
import { ecuadorDate } from "../../catalogs/infrastructure/index.ts";
import type { SigningProfile } from "../../fiscal/infrastructure/index.ts";
import type { Authorizer } from "../../identity/application/authorization.ts";
import { createDebitNoteXmlBuilder } from "../../sri-engine/infrastructure/debit-note-xml-builder.ts";
import { createDebitNotes } from "../application/debit-notes.ts";
import { createDebitNoteDrafts } from "../application/drafts.ts";
import type { InvoiceSourceReader } from "../application/ports.ts";
import { debitNoteSigningProfile as createDebitNoteSigningProfile } from "../application/signing-profile.ts";
import { createDebitEligibleInvoiceReader } from "./eligible-invoices.ts";
import { debitNotesRouter } from "./http/debit-notes-router.ts";
import { createDebitNoteDraftRepository } from "./prisma-drafts.ts";
import { createDebitNotesReads, type SigningReads } from "./reads.ts";
import { createDebitNoteDraftsUnitOfWork } from "./units-of-work.ts";

/** Perfil de la nota de débito para la firma compartida, con el builder `notaDebito` 1.0.0. */
export const debitNoteSigningProfile = (): SigningProfile =>
  createDebitNoteSigningProfile(createDebitNoteXmlBuilder());

export type DebitNotesModuleOptions = {
  prisma: PrismaClient;
  /** Esquema de la base de la conexión: la consulta de las facturas elegibles lo nombra. */
  schema: string;
  authorizer: Authorizer;
  /** Firma vigente sobre un cliente (`signingModule(...).reads`). */
  signingReads: SigningReads;
  /** Factura de origen (`invoiceCreditSource` de `invoices`), compuesta por `main.ts`. */
  invoices: InvoiceSourceReader;
  now?: () => Date;
};

export function debitNotesModule(options: DebitNotesModuleOptions) {
  const now = options.now ?? (() => new Date());
  const today = () => ecuadorDate(now());
  const { prisma } = options;
  const reads = createDebitNotesReads(prisma, options.signingReads);
  const context = { reads, invoices: options.invoices(prisma) };
  const drafts = createDebitNoteDrafts({
    drafts: createDebitNoteDraftRepository(prisma),
    uow: createDebitNoteDraftsUnitOfWork(prisma),
    context,
    authorizer: options.authorizer,
    today,
  });
  const debitNotes = createDebitNotes({
    authorizer: options.authorizer,
    eligible: createDebitEligibleInvoiceReader(prisma, options.schema),
    reads,
  });
  return {
    routers: [debitNotesRouter({ drafts, debitNotes })],
    drafts,
    debitNotes,
  };
}

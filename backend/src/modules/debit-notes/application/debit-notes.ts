// Consultas de las notas de débito (add-debit-notes, design D20): las facturas que admiten una nota
// de débito. Cada operación exige su permiso en el servidor y la empresa sale de la sesión.
import { listDebitEligibleInvoicesQuerySchema } from "@facturador/contracts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { Page } from "./drafts.ts";
import type { DebitEligibleInvoice, DebitEligibleInvoiceReader, DebitNotesReads } from "./ports.ts";

export type DebitNotesDependencies = {
  authorizer: Authorizer;
  eligible: DebitEligibleInvoiceReader;
  reads: Pick<DebitNotesReads, "currentConfig">;
};

export function createDebitNotes(deps: DebitNotesDependencies) {
  return {
    /** Facturas autorizadas, sin consumidor final y del ambiente en que la empresa emite. */
    async eligibleInvoices(
      ctx: RequestContext,
      query: unknown,
    ): Promise<Page<DebitEligibleInvoice>> {
      deps.authorizer.requirePermission(ctx, "debitNotes.draft");
      const { search, page, pageSize } = parseInput(listDebitEligibleInvoicesQuerySchema, query);
      const config = await deps.reads.currentConfig(ctx.companyId);
      const { items, total } = await deps.eligible.list(ctx.companyId, {
        search,
        environment: config?.environment ?? null,
        page,
        pageSize,
      });
      return { items, meta: { page, pageSize, total } };
    },
  };
}

export type DebitNotes = ReturnType<typeof createDebitNotes>;

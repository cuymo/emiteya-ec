// Lista unificada de facturas (unify-drafts-into-document-lists, design D1 a D4): los borradores
// primero, el último editado arriba, y después las facturas emitidas. «Requiere atención» y un estado
// de factura emitida excluyen los borradores; `DRAFT` deja solo los borradores. La búsqueda los
// encuentra por el comprador.
import { listInvoiceEntriesQuerySchema } from "@facturador/contracts";
import {
  draftsFirstPage,
  filteredPages,
  textMatches,
  type Entry,
  type PageFetcher,
} from "../../../platform/pagination/drafts-first.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { DraftDetails, Drafts } from "./drafts.ts";
import type { InvoiceListItem, Invoices } from "./invoices.ts";
import type { Page } from "./ports.ts";

export type InvoiceEntry = Entry<DraftDetails, InvoiceListItem>;

export function createInvoiceEntries(deps: {
  authorizer: Authorizer;
  drafts: Drafts;
  invoices: Invoices;
}) {
  return {
    async list(ctx: RequestContext, query: unknown): Promise<Page<InvoiceEntry>> {
      deps.authorizer.requirePermission(ctx, "invoices.read");
      const { search, state, attention, page, pageSize } = parseInput(
        listInvoiceEntriesQuerySchema,
        query,
      );
      const withDrafts =
        deps.authorizer.allows(ctx, "invoices.draft") &&
        !attention &&
        (state === undefined || state === "DRAFT");

      const draftPages: PageFetcher<DraftDetails> = async (draftPage, size) => {
        const { items, meta } = await deps.drafts.list(ctx, { page: draftPage, pageSize: size });
        return { items, total: meta.total };
      };
      const drafts = !withDrafts
        ? null
        : search
          ? filteredPages(draftPages, ({ input }) =>
              textMatches(search, input.buyer?.legalName, input.buyer?.identification),
            )
          : draftPages;
      const documents: PageFetcher<InvoiceListItem> | null =
        state === "DRAFT"
          ? null
          : async (documentPage, size) => {
              const { items, meta } = await deps.invoices.list(ctx, {
                search,
                state,
                attention,
                page: documentPage,
                pageSize: size,
              });
              return { items, total: meta.total };
            };

      const { items, total } = await draftsFirstPage({ page, pageSize, drafts, documents });
      return { items: [...items], meta: { page, pageSize, total } };
    },
  };
}

export type InvoiceEntries = ReturnType<typeof createInvoiceEntries>;

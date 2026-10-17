// Lista unificada de notas de crédito (unify-drafts-into-document-lists, design D1 a D4): los
// borradores primero, el último editado arriba, y después los comprobantes emitidos. Un estado
// emitido excluye los borradores y `DRAFT` deja solo los borradores; la causa también filtra los borradores; la búsqueda los encuentra por el comprador o la factura modificada.
import {
  listCreditNoteEntriesQuerySchema,
  type CreditNoteDraftSummaryView,
} from "@facturador/contracts";
import {
  unifiedPage,
  textMatches,
  type Entry,
  type PageFetcher,
} from "../../../platform/pagination/drafts-first.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { CreditNoteDrafts, CreditNoteDraftDetails } from "./drafts.ts";
import type { CreditNoteListItem, CreditNotes } from "./credit-notes.ts";

export type CreditNoteEntry = Entry<CreditNoteDraftSummaryView, CreditNoteListItem>;

export function createCreditNoteEntries(deps: {
  authorizer: Authorizer;
  drafts: CreditNoteDrafts;
  creditNotes: CreditNotes;
  /** El resumen de un borrador para la lista, el mismo de su lista propia. */
  draftView: (
    ctx: RequestContext,
    draft: CreditNoteDraftDetails,
  ) => CreditNoteDraftSummaryView | Promise<CreditNoteDraftSummaryView>;
}) {
  return {
    async list(
      ctx: RequestContext,
      query: unknown,
    ): Promise<{
      items: CreditNoteEntry[];
      meta: { page: number; pageSize: number; total: number };
    }> {
      deps.authorizer.requirePermission(ctx, "creditNotes.read");
      const { search, state, cause, page, pageSize } = parseInput(
        listCreditNoteEntriesQuerySchema,
        query,
      );
      const withDrafts =
        deps.authorizer.allows(ctx, "creditNotes.draft") &&
        (state === undefined || state === "DRAFT");

      const drafts: PageFetcher<CreditNoteDraftSummaryView> = async (draftPage, size) => {
        const { items, meta } = await deps.drafts.list(ctx, { page: draftPage, pageSize: size });
        const views: CreditNoteDraftSummaryView[] = [];
        for (const draft of items) views.push(await deps.draftView(ctx, draft));
        return { items: views, total: meta.total };
      };
      const documents: PageFetcher<CreditNoteListItem> = async (documentPage, size) => {
        const { items, meta } = await deps.creditNotes.list(ctx, {
          search,
          state,
          cause,
          page: documentPage,
          pageSize: size,
        });
        return { items, total: meta.total };
      };

      const { items, total } = await unifiedPage({
        page,
        pageSize,
        drafts: withDrafts ? drafts : null,
        documents: state === "DRAFT" ? null : documents,
        draftFilter:
          search || cause
            ? (draft) =>
                (!search || textMatches(search, draft.buyerName, draft.invoice.documentNumber)) &&
                (!cause || draft.cause === cause)
            : null,
      });
      return { items: [...items], meta: { page, pageSize, total } };
    },
  };
}

export type CreditNoteEntries = ReturnType<typeof createCreditNoteEntries>;

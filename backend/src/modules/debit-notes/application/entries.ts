// Lista unificada de notas de débito (unify-drafts-into-document-lists, design D1 a D4): los
// borradores primero, el último editado arriba, y después los comprobantes emitidos. Un estado
// emitido excluye los borradores y `DRAFT` deja solo los borradores; una causa los excluye, porque su resumen no las lleva; la búsqueda los encuentra por el comprador o la factura modificada.
import {
  listDebitNoteEntriesQuerySchema,
  type DebitNoteDraftSummaryView,
} from "@facturador/contracts";
import {
  unifiedPage,
  textMatches,
  type Entry,
  type PageFetcher,
} from "../../../platform/pagination/drafts-first.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { DebitNoteDrafts, DebitNoteDraftDetails } from "./drafts.ts";
import type { DebitNoteListItem, DebitNotes } from "./debit-notes.ts";

export type DebitNoteEntry = Entry<DebitNoteDraftSummaryView, DebitNoteListItem>;

export function createDebitNoteEntries(deps: {
  authorizer: Authorizer;
  drafts: DebitNoteDrafts;
  debitNotes: DebitNotes;
  /** El resumen de un borrador para la lista, el mismo de su lista propia. */
  draftView: (
    ctx: RequestContext,
    draft: DebitNoteDraftDetails,
  ) => DebitNoteDraftSummaryView | Promise<DebitNoteDraftSummaryView>;
}) {
  return {
    async list(
      ctx: RequestContext,
      query: unknown,
    ): Promise<{
      items: DebitNoteEntry[];
      meta: { page: number; pageSize: number; total: number };
    }> {
      deps.authorizer.requirePermission(ctx, "debitNotes.read");
      const { search, state, cause, page, pageSize } = parseInput(
        listDebitNoteEntriesQuerySchema,
        query,
      );
      const withDrafts =
        deps.authorizer.allows(ctx, "debitNotes.draft") &&
        !cause &&
        (state === undefined || state === "DRAFT");

      const drafts: PageFetcher<DebitNoteDraftSummaryView> = async (draftPage, size) => {
        const { items, meta } = await deps.drafts.list(ctx, { page: draftPage, pageSize: size });
        const views: DebitNoteDraftSummaryView[] = [];
        for (const draft of items) views.push(await deps.draftView(ctx, draft));
        return { items: views, total: meta.total };
      };
      const documents: PageFetcher<DebitNoteListItem> = async (documentPage, size) => {
        const { items, meta } = await deps.debitNotes.list(ctx, {
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
        draftFilter: search
          ? (draft) => !search || textMatches(search, draft.buyerName, draft.invoice.documentNumber)
          : null,
      });
      return { items: [...items], meta: { page, pageSize, total } };
    },
  };
}

export type DebitNoteEntries = ReturnType<typeof createDebitNoteEntries>;

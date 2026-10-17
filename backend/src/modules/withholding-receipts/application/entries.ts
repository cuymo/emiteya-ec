// Lista unificada de retenciones (unify-drafts-into-document-lists, design D1 a D4): los
// borradores primero, el último editado arriba, y después los comprobantes emitidos. Un estado
// emitido excluye los borradores y `DRAFT` deja solo los borradores; el período fiscal también filtra los borradores; la búsqueda los encuentra por el sujeto retenido.
import {
  listWithholdingReceiptEntriesQuerySchema,
  type WithholdingDraftSummaryView,
} from "@facturador/contracts";
import {
  unifiedPage,
  textMatches,
  type Entry,
  type PageFetcher,
} from "../../../platform/pagination/drafts-first.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { WithholdingDrafts, WithholdingDraftDetails } from "./drafts.ts";
import type { WithholdingReceiptListItem, WithholdingReceipts } from "./withholding-receipts.ts";

export type WithholdingReceiptEntry = Entry<
  WithholdingDraftSummaryView,
  WithholdingReceiptListItem
>;

export function createWithholdingReceiptEntries(deps: {
  authorizer: Authorizer;
  drafts: WithholdingDrafts;
  withholdings: WithholdingReceipts;
  /** El resumen de un borrador para la lista, el mismo de su lista propia. */
  draftView: (
    ctx: RequestContext,
    draft: WithholdingDraftDetails,
  ) => WithholdingDraftSummaryView | Promise<WithholdingDraftSummaryView>;
}) {
  return {
    async list(
      ctx: RequestContext,
      query: unknown,
    ): Promise<{
      items: WithholdingReceiptEntry[];
      meta: { page: number; pageSize: number; total: number };
    }> {
      deps.authorizer.requirePermission(ctx, "withholdings.read");
      const { search, state, fiscalPeriod, page, pageSize } = parseInput(
        listWithholdingReceiptEntriesQuerySchema,
        query,
      );
      const withDrafts =
        deps.authorizer.allows(ctx, "withholdings.draft") &&
        (state === undefined || state === "DRAFT");

      const drafts: PageFetcher<WithholdingDraftSummaryView> = async (draftPage, size) => {
        const { items, meta } = await deps.drafts.list(ctx, { page: draftPage, pageSize: size });
        const views: WithholdingDraftSummaryView[] = [];
        for (const draft of items) views.push(await deps.draftView(ctx, draft));
        return { items: views, total: meta.total };
      };
      const documents: PageFetcher<WithholdingReceiptListItem> = async (documentPage, size) => {
        const { items, meta } = await deps.withholdings.list(ctx, {
          search,
          state,
          fiscalPeriod,
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
          search || fiscalPeriod
            ? (draft) =>
                (!search || textMatches(search, draft.partyName)) &&
                (!fiscalPeriod || draft.fiscalPeriod === fiscalPeriod)
            : null,
      });
      return { items: [...items], meta: { page, pageSize, total } };
    },
  };
}

export type WithholdingReceiptEntries = ReturnType<typeof createWithholdingReceiptEntries>;

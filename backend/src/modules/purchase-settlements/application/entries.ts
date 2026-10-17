// Lista unificada de liquidaciones de compra (unify-drafts-into-document-lists, design D1 a D4): los
// borradores primero, el último editado arriba, y después los comprobantes emitidos. Un estado
// emitido excluye los borradores y `DRAFT` deja solo los borradores; la búsqueda los encuentra por el proveedor.
import {
  listPurchaseSettlementEntriesQuerySchema,
  type PurchaseSettlementDraftSummaryView,
} from "@facturador/contracts";
import {
  unifiedPage,
  textMatches,
  type Entry,
  type PageFetcher,
} from "../../../platform/pagination/drafts-first.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { PurchaseSettlementDrafts, PurchaseSettlementDraftDetails } from "./drafts.ts";
import type { PurchaseSettlementListItem, PurchaseSettlements } from "./purchase-settlements.ts";

export type PurchaseSettlementEntry = Entry<
  PurchaseSettlementDraftSummaryView,
  PurchaseSettlementListItem
>;

export function createPurchaseSettlementEntries(deps: {
  authorizer: Authorizer;
  drafts: PurchaseSettlementDrafts;
  settlements: PurchaseSettlements;
  /** El resumen de un borrador para la lista, el mismo de su lista propia. */
  draftView: (
    ctx: RequestContext,
    draft: PurchaseSettlementDraftDetails,
  ) => PurchaseSettlementDraftSummaryView | Promise<PurchaseSettlementDraftSummaryView>;
}) {
  return {
    async list(
      ctx: RequestContext,
      query: unknown,
    ): Promise<{
      items: PurchaseSettlementEntry[];
      meta: { page: number; pageSize: number; total: number };
    }> {
      deps.authorizer.requirePermission(ctx, "purchaseSettlements.read");
      const { search, state, page, pageSize } = parseInput(
        listPurchaseSettlementEntriesQuerySchema,
        query,
      );
      const withDrafts =
        deps.authorizer.allows(ctx, "purchaseSettlements.draft") &&
        (state === undefined || state === "DRAFT");

      const drafts: PageFetcher<PurchaseSettlementDraftSummaryView> = async (draftPage, size) => {
        const { items, meta } = await deps.drafts.list(ctx, { page: draftPage, pageSize: size });
        const views: PurchaseSettlementDraftSummaryView[] = [];
        for (const draft of items) views.push(await deps.draftView(ctx, draft));
        return { items: views, total: meta.total };
      };
      const documents: PageFetcher<PurchaseSettlementListItem> = async (documentPage, size) => {
        const { items, meta } = await deps.settlements.list(ctx, {
          search,
          state,
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
        draftFilter: search ? (draft) => !search || textMatches(search, draft.supplierName) : null,
      });
      return { items: [...items], meta: { page, pageSize, total } };
    },
  };
}

export type PurchaseSettlementEntries = ReturnType<typeof createPurchaseSettlementEntries>;

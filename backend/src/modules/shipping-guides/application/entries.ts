// Lista unificada de guías de remisión (unify-drafts-into-document-lists, design D1 a D4): los
// borradores primero, el último editado arriba, y después los comprobantes emitidos. Un estado
// emitido excluye los borradores y `DRAFT` deja solo los borradores; la búsqueda los encuentra por el transportista.
import {
  listShippingGuideEntriesQuerySchema,
  type ShippingGuideDraftSummaryView,
} from "@facturador/contracts";
import {
  unifiedPage,
  textMatches,
  type Entry,
  type PageFetcher,
} from "../../../platform/pagination/drafts-first.ts";
import { parseInput, type Authorizer } from "../../identity/application/authorization.ts";
import type { RequestContext } from "../../identity/application/request-context.ts";
import type { ShippingGuideDraftRecord } from "../domain/draft.ts";
import type { ShippingGuideDrafts } from "./drafts.ts";
import type { ShippingGuideListItem, ShippingGuides } from "./shipping-guides.ts";

export type ShippingGuideEntry = Entry<ShippingGuideDraftSummaryView, ShippingGuideListItem>;

export function createShippingGuideEntries(deps: {
  authorizer: Authorizer;
  drafts: ShippingGuideDrafts;
  guides: ShippingGuides;
  /** El resumen de un borrador para la lista, el mismo de su lista propia. */
  draftView: (
    ctx: RequestContext,
    draft: ShippingGuideDraftRecord,
  ) => ShippingGuideDraftSummaryView | Promise<ShippingGuideDraftSummaryView>;
}) {
  return {
    async list(
      ctx: RequestContext,
      query: unknown,
    ): Promise<{
      items: ShippingGuideEntry[];
      meta: { page: number; pageSize: number; total: number };
    }> {
      deps.authorizer.requirePermission(ctx, "shippingGuides.read");
      const { search, state, page, pageSize } = parseInput(
        listShippingGuideEntriesQuerySchema,
        query,
      );
      const withDrafts =
        deps.authorizer.allows(ctx, "shippingGuides.draft") &&
        (state === undefined || state === "DRAFT");

      const drafts: PageFetcher<ShippingGuideDraftSummaryView> = async (draftPage, size) => {
        const { items, meta } = await deps.drafts.list(ctx, { page: draftPage, pageSize: size });
        const views: ShippingGuideDraftSummaryView[] = [];
        for (const draft of items) views.push(await deps.draftView(ctx, draft));
        return { items: views, total: meta.total };
      };
      const documents: PageFetcher<ShippingGuideListItem> = async (documentPage, size) => {
        const { items, meta } = await deps.guides.list(ctx, {
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
        draftFilter: search ? (draft) => !search || textMatches(search, draft.carrierName) : null,
      });
      return { items: [...items], meta: { page, pageSize, total } };
    },
  };
}

export type ShippingGuideEntries = ReturnType<typeof createShippingGuideEntries>;

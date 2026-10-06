// Rutas de las guías de remisión bajo /api/v1 (add-shipping-guides, design D22). La empresa, el rol y
// el autor salen del contexto de la sesión; un recurso de otra empresa es `404`. Ninguna ruta envía
// al SRI ni expone XML o respuestas originales.
import { Router, type Response } from "express";
import {
  IDEMPOTENCY_KEY_HEADER,
  type ListMeta,
  type ShippingGuideView,
} from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import {
  createStageTimings,
  serverTimingHeader,
} from "../../../../platform/metrics/stage-timings.ts";
import type { ShippingGuideDrafts } from "../../application/drafts.ts";
import type { ShippingGuideEmission } from "../../application/emission.ts";
import type { ShippingGuideOptions } from "../../application/options.ts";
import type { ShippingGuides } from "../../application/shipping-guides.ts";
import {
  toEligibleInvoiceView,
  toRecipientPartyView,
  toShippingGuideDraftSummaryView,
  toShippingGuideDraftView,
  toShippingGuideSummaryView,
  toShippingGuideTransmissionView,
  toShippingGuideView,
} from "./views.ts";

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

const param = (value: unknown) => String(value);

export type ShippingGuidesRouterDependencies = {
  drafts: ShippingGuideDrafts;
  options: ShippingGuideOptions;
  emission: ShippingGuideEmission;
  guides: ShippingGuides;
  /** EMISSION_STAGE_TIMINGS: cabecera `Server-Timing` en la emisión. */
  serverTiming?: boolean;
  /** Nombre del transportista de un borrador para la lista (el de su tercero, o la empresa). */
  carrierName?: (companyId: string, partyId: string | null) => Promise<string | null>;
};

export function shippingGuidesRouter({
  drafts,
  options,
  emission,
  guides,
  serverTiming = false,
  carrierName = () => Promise.resolve(null),
}: ShippingGuidesRouterDependencies): Router {
  const router = Router();

  router.get("/shipping-guides/carriers", async (req, res) => {
    const { items, meta } = await options.carriers(contextOf(res), req.query);
    send(res, 200, items, meta);
  });

  router.get("/shipping-guides/recipients", async (req, res) => {
    const { items, meta } = await options.recipients(contextOf(res), req.query);
    send(res, 200, items.map(toRecipientPartyView), meta);
  });

  router.get("/shipping-guides/eligible-invoices", async (req, res) => {
    const { items, meta } = await options.eligibleInvoices(contextOf(res), req.query);
    send(res, 200, items.map(toEligibleInvoiceView), meta);
  });

  router.get("/shipping-guides/eligible-invoices/:invoiceId/goods", async (req, res) => {
    send(res, 200, await options.invoiceGoods(contextOf(res), param(req.params.invoiceId)));
  });

  router.get("/shipping-guides/options", async (_req, res) => {
    send(res, 200, await options.options(contextOf(res)));
  });

  router.get("/shipping-guides/drafts", async (req, res) => {
    const ctx = contextOf(res);
    const { items, meta } = await drafts.list(ctx, req.query);
    const views = [];
    for (const draft of items) {
      const name =
        draft.transporter === null
          ? null
          : await carrierName(
              ctx.companyId,
              draft.transporter.source === "PARTY" ? draft.transporter.partyId : null,
            );
      views.push(toShippingGuideDraftSummaryView(draft, name));
    }
    send(res, 200, views, meta);
  });

  router.post("/shipping-guides/drafts", async (req, res) => {
    send(res, 201, toShippingGuideDraftView(await drafts.create(contextOf(res), req.body)));
  });

  router.get("/shipping-guides/drafts/:draftId", async (req, res) => {
    send(
      res,
      200,
      toShippingGuideDraftView(await drafts.get(contextOf(res), param(req.params.draftId))),
    );
  });

  router.put("/shipping-guides/drafts/:draftId", async (req, res) => {
    const details = await drafts.update(contextOf(res), param(req.params.draftId), req.body);
    send(res, 200, toShippingGuideDraftView(details));
  });

  router.delete("/shipping-guides/drafts/:draftId", async (req, res) => {
    await drafts.remove(contextOf(res), param(req.params.draftId));
    res.status(204).end();
  });

  router.post("/shipping-guides", async (req, res) => {
    const timings = createStageTimings();
    let result: { view: ShippingGuideView; replayed: boolean };
    try {
      result = await timings.envelope("total", async () => {
        const { document, replayed } = await emission.emit(
          contextOf(res),
          req.header(IDEMPOTENCY_KEY_HEADER),
          req.body,
          timings,
        );
        return { view: toShippingGuideView(await guides.details(document)), replayed };
      });
    } finally {
      if (serverTiming) res.setHeader("Server-Timing", serverTimingHeader(timings.entries()));
    }
    send(res, result.replayed ? 200 : 201, result.view);
  });

  router.get("/shipping-guides", async (req, res) => {
    const { items, meta } = await guides.list(contextOf(res), req.query);
    send(res, 200, items.map(toShippingGuideSummaryView), meta);
  });

  router.get("/shipping-guides/:shippingGuideId", async (req, res) => {
    const details = await guides.get(contextOf(res), param(req.params.shippingGuideId));
    send(res, 200, toShippingGuideView(details));
  });

  router.get("/shipping-guides/:shippingGuideId/transmission", async (req, res) => {
    const view = await guides.transmission(contextOf(res), param(req.params.shippingGuideId));
    send(res, 200, toShippingGuideTransmissionView(view));
  });

  router.post("/shipping-guides/:shippingGuideId/reconciliations", async (req, res) => {
    const details = await guides.requestReconciliation(
      contextOf(res),
      param(req.params.shippingGuideId),
      req.body,
    );
    send(res, 202, toShippingGuideView(details));
  });

  router.post("/shipping-guides/:shippingGuideId/signing-attempts", async (req, res) => {
    const details = await guides.retrySigning(contextOf(res), param(req.params.shippingGuideId));
    send(res, 200, toShippingGuideView(details));
  });

  return router;
}

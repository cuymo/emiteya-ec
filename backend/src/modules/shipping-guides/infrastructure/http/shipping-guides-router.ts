// Rutas de las guías de remisión bajo /api/v1 (add-shipping-guides, design D22). La empresa, el rol y
// el autor salen del contexto de la sesión; un recurso de otra empresa es `404`. Ninguna ruta envía
// al SRI ni expone XML o respuestas originales. Crear y actualizar un borrador leen su cuerpo con un
// límite propio de 2 MiB (design D23, segunda capa); el resto conserva el parser global de 100 KB.
import express, { Router, type Request, type Response } from "express";
import type { ShippingGuideEntries } from "../../application/entries.ts";
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

/**
 * Límite del cuerpo JSON de las rutas que reciben el borrador completo: 2 MiB, una defensa de
 * recursos HTTP del proyecto (design D23). Hace alcanzables por HTTP los máximos absolutos de la guía
 * con textos multibyte de longitud máxima; no es un límite del SRI, del XSD ni del XML, ni una
 * interpretación de Q-47. Después de leer el cuerpo rigen el contrato y los límites estructurales.
 */
export const SHIPPING_GUIDE_DRAFT_BODY_LIMIT_BYTES = 2_097_152;

const DRAFTS_PATH = "/api/v1/shipping-guides/drafts";
const DRAFT_PATH = /^\/api\/v1\/shipping-guides\/drafts\/[^/]+$/;

/**
 * Crear (`POST /drafts`) y actualizar (`PUT /drafts/{id}`) un borrador traen su propio parser: el
 * global se los salta (app.ts, jsonBodyExceptions). Ninguna otra ruta, tampoco la emisión.
 */
export const isShippingGuideDraftBody = (req: Request): boolean =>
  (req.method === "POST" && req.path === DRAFTS_PATH) ||
  (req.method === "PUT" && DRAFT_PATH.test(req.path));

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

const param = (value: unknown) => String(value);

export type ShippingGuidesRouterDependencies = {
  drafts: ShippingGuideDrafts;
  entries: ShippingGuideEntries;
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
  entries,
  options,
  emission,
  guides,
  serverTiming = false,
  carrierName = () => Promise.resolve(null),
}: ShippingGuidesRouterDependencies): Router {
  const router = Router();
  const draftBody = express.json({ limit: SHIPPING_GUIDE_DRAFT_BODY_LIMIT_BYTES });

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

  router.post("/shipping-guides/drafts", draftBody, async (req, res) => {
    send(res, 201, toShippingGuideDraftView(await drafts.create(contextOf(res), req.body)));
  });

  router.get("/shipping-guides/drafts/:draftId", async (req, res) => {
    send(
      res,
      200,
      toShippingGuideDraftView(await drafts.get(contextOf(res), param(req.params.draftId))),
    );
  });

  router.put("/shipping-guides/drafts/:draftId", draftBody, async (req, res) => {
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

  // Antes de `/shipping-guides/:id`: borradores primero y después comprobantes emitidos.
  router.get("/shipping-guides/entries", async (req, res) => {
    const { items, meta } = await entries.list(contextOf(res), req.query);
    send(
      res,
      200,
      items.map((entry) =>
        entry.kind === "DRAFT"
          ? entry
          : { kind: "DOCUMENT" as const, document: toShippingGuideSummaryView(entry.document) },
      ),
      meta,
    );
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

// Rutas de los comprobantes de retención bajo /api/v1 (add-withholding-receipts, design D21). La
// empresa, el rol y el autor salen del contexto de la sesión; un recurso de otra empresa es `404`.
// Ninguna ruta envía al SRI ni expone XML o respuestas originales.
import { Router, type Response } from "express";
import {
  IDEMPOTENCY_KEY_HEADER,
  type ListMeta,
  type WithholdingReceiptView,
} from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import {
  createStageTimings,
  serverTimingHeader,
} from "../../../../platform/metrics/stage-timings.ts";
import type { WithholdingDrafts } from "../../application/drafts.ts";
import type { WithholdingEmission } from "../../application/emission.ts";
import type { WithholdingOptions } from "../../application/options.ts";
import type { WithholdingReceipts } from "../../application/withholding-receipts.ts";
import {
  toWithholdingDraftSummaryView,
  toWithholdingDraftView,
  toWithholdingReceiptView,
  toWithholdingSupplierView,
} from "./views.ts";

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

const param = (value: unknown) => String(value);

export type WithholdingReceiptsRouterDependencies = {
  drafts: WithholdingDrafts;
  options: WithholdingOptions;
  emission: WithholdingEmission;
  withholdings: WithholdingReceipts;
  /** EMISSION_STAGE_TIMINGS: cabecera `Server-Timing` en la emisión. */
  serverTiming?: boolean;
};

export function withholdingReceiptsRouter({
  drafts,
  options,
  emission,
  withholdings,
  serverTiming = false,
}: WithholdingReceiptsRouterDependencies): Router {
  const router = Router();

  router.get("/withholding-receipts/suppliers", async (req, res) => {
    const { items, meta } = await options.suppliers(contextOf(res), req.query);
    send(res, 200, items.map(toWithholdingSupplierView), meta);
  });

  router.get("/withholding-receipts/options", async (_req, res) => {
    send(res, 200, await options.options(contextOf(res)));
  });

  router.get("/withholding-receipts/drafts", async (req, res) => {
    const { items, meta } = await drafts.list(contextOf(res), req.query);
    send(res, 200, items.map(toWithholdingDraftSummaryView), meta);
  });

  router.post("/withholding-receipts/drafts", async (req, res) => {
    send(res, 201, toWithholdingDraftView(await drafts.create(contextOf(res), req.body)));
  });

  router.get("/withholding-receipts/drafts/:draftId", async (req, res) => {
    send(
      res,
      200,
      toWithholdingDraftView(await drafts.get(contextOf(res), param(req.params.draftId))),
    );
  });

  router.put("/withholding-receipts/drafts/:draftId", async (req, res) => {
    const details = await drafts.update(contextOf(res), param(req.params.draftId), req.body);
    send(res, 200, toWithholdingDraftView(details));
  });

  router.delete("/withholding-receipts/drafts/:draftId", async (req, res) => {
    await drafts.remove(contextOf(res), param(req.params.draftId));
    res.status(204).end();
  });

  router.post("/withholding-receipts", async (req, res) => {
    const timings = createStageTimings();
    let result: { view: WithholdingReceiptView; replayed: boolean };
    try {
      result = await timings.envelope("total", async () => {
        const { document, replayed } = await emission.emit(
          contextOf(res),
          req.header(IDEMPOTENCY_KEY_HEADER),
          req.body,
          timings,
        );
        return { view: toWithholdingReceiptView(await withholdings.details(document)), replayed };
      });
    } finally {
      if (serverTiming) res.setHeader("Server-Timing", serverTimingHeader(timings.entries()));
    }
    send(res, result.replayed ? 200 : 201, result.view);
  });

  router.post("/withholding-receipts/:withholdingReceiptId/signing-attempts", async (req, res) => {
    const details = await withholdings.retrySigning(
      contextOf(res),
      param(req.params.withholdingReceiptId),
    );
    send(res, 200, toWithholdingReceiptView(details));
  });

  return router;
}

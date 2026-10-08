// Rutas de las liquidaciones de compra bajo /api/v1 (add-purchase-settlements, design D21). La
// empresa, el rol y el autor salen del contexto de la sesión; un recurso de otra empresa es `404`.
// Ninguna ruta envía al SRI ni expone XML o respuestas originales. Crear y actualizar un borrador
// leen su cuerpo con un límite propio de 4 MiB (design D22); el resto, también la emisión, conserva el
// parser global de 100 KB.
import express, { Router, type Request, type Response } from "express";
import type { ListMeta } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { PurchaseSettlementDrafts } from "../../application/drafts.ts";
import type { PurchaseSettlementOptions } from "../../application/options.ts";
import { toPurchaseSettlementDraftSummaryView, toPurchaseSettlementDraftView } from "./views.ts";

/**
 * Límite del cuerpo JSON de las rutas que reciben el borrador completo: 4 MiB, una defensa de
 * recursos HTTP del proyecto (design D22). Hace alcanzables por HTTP los máximos absolutos de la
 * liquidación (1000 líneas y 20 pagos) con textos multibyte de longitud máxima, también escapados como
 * `\u`; no es un límite del SRI, del XSD ni del XML, ni una interpretación de Q-47. Después de leer el
 * cuerpo rigen el contrato y los límites de recursos.
 */
export const PURCHASE_SETTLEMENT_DRAFT_BODY_LIMIT_BYTES = 4_194_304;

const DRAFTS_PATH = "/api/v1/purchase-settlements/drafts";
const DRAFT_PATH = /^\/api\/v1\/purchase-settlements\/drafts\/[^/]+$/;

/**
 * Crear (`POST /drafts`) y actualizar (`PUT /drafts/{id}`) un borrador traen su propio parser: el
 * global se los salta (app.ts, jsonBodyExceptions). Ninguna otra ruta, tampoco la emisión.
 */
export const isPurchaseSettlementDraftBody = (req: Request): boolean =>
  (req.method === "POST" && req.path === DRAFTS_PATH) ||
  (req.method === "PUT" && DRAFT_PATH.test(req.path));

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

const param = (value: unknown) => String(value);

export type PurchaseSettlementsRouterDependencies = {
  drafts: PurchaseSettlementDrafts;
  options: PurchaseSettlementOptions;
};

export function purchaseSettlementsRouter({
  drafts,
  options,
}: PurchaseSettlementsRouterDependencies): Router {
  const router = Router();
  const draftBody = express.json({ limit: PURCHASE_SETTLEMENT_DRAFT_BODY_LIMIT_BYTES });

  router.get("/purchase-settlements/suppliers", async (req, res) => {
    const { items, meta } = await options.suppliers(contextOf(res), req.query);
    send(res, 200, items, meta);
  });

  router.get("/purchase-settlements/options", async (_req, res) => {
    send(res, 200, await options.options(contextOf(res)));
  });

  router.get("/purchase-settlements/drafts", async (req, res) => {
    const { items, meta } = await drafts.list(contextOf(res), req.query);
    send(res, 200, items.map(toPurchaseSettlementDraftSummaryView), meta);
  });

  router.post("/purchase-settlements/drafts", draftBody, async (req, res) => {
    send(res, 201, toPurchaseSettlementDraftView(await drafts.create(contextOf(res), req.body)));
  });

  router.get("/purchase-settlements/drafts/:draftId", async (req, res) => {
    const details = await drafts.get(contextOf(res), param(req.params.draftId));
    send(res, 200, toPurchaseSettlementDraftView(details));
  });

  router.put("/purchase-settlements/drafts/:draftId", draftBody, async (req, res) => {
    const details = await drafts.update(contextOf(res), param(req.params.draftId), req.body);
    send(res, 200, toPurchaseSettlementDraftView(details));
  });

  router.delete("/purchase-settlements/drafts/:draftId", async (req, res) => {
    await drafts.remove(contextOf(res), param(req.params.draftId));
    res.status(204).end();
  });

  return router;
}

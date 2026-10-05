// Rutas de las notas de débito bajo /api/v1 (add-debit-notes, design D20). La empresa, el rol y el
// autor salen del contexto de la sesión; un recurso de otra empresa es `404`. Ninguna ruta envía al
// SRI ni expone XML o respuestas originales.
import { Router, type Response } from "express";
import type { ListMeta } from "@facturador/contracts";
import { contextOf } from "../../../identity/infrastructure/http/request-context.ts";
import type { DebitNotes } from "../../application/debit-notes.ts";
import type { DebitNoteDrafts } from "../../application/drafts.ts";
import {
  toDebitEligibleInvoiceView,
  toDebitNoteDraftSummaryView,
  toDebitNoteDraftView,
} from "./views.ts";

function send<T>(res: Response, status: number, data: T, meta?: ListMeta) {
  res.status(status).json(meta ? { data, meta } : { data });
}

const param = (value: unknown) => String(value);

export type DebitNotesRouterDependencies = {
  drafts: DebitNoteDrafts;
  debitNotes: DebitNotes;
};

export function debitNotesRouter({ drafts, debitNotes }: DebitNotesRouterDependencies): Router {
  const router = Router();

  router.get("/debit-notes/eligible-invoices", async (req, res) => {
    const { items, meta } = await debitNotes.eligibleInvoices(contextOf(res), req.query);
    send(res, 200, items.map(toDebitEligibleInvoiceView), meta);
  });

  router.get("/debit-notes/drafts", async (req, res) => {
    const { items, meta } = await drafts.list(contextOf(res), req.query);
    send(res, 200, items.map(toDebitNoteDraftSummaryView), meta);
  });

  router.post("/debit-notes/drafts", async (req, res) => {
    send(res, 201, toDebitNoteDraftView(await drafts.create(contextOf(res), req.body)));
  });

  router.get("/debit-notes/drafts/:draftId", async (req, res) => {
    send(
      res,
      200,
      toDebitNoteDraftView(await drafts.get(contextOf(res), param(req.params.draftId))),
    );
  });

  router.put("/debit-notes/drafts/:draftId", async (req, res) => {
    const details = await drafts.update(contextOf(res), param(req.params.draftId), req.body);
    send(res, 200, toDebitNoteDraftView(details));
  });

  router.delete("/debit-notes/drafts/:draftId", async (req, res) => {
    await drafts.remove(contextOf(res), param(req.params.draftId));
    res.status(204).end();
  });

  return router;
}
